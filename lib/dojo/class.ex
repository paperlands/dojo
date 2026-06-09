defmodule Dojo.Class do
  use DynamicSupervisor
  alias Dojo.Table

  # takes care of all disciples across all tables

  def start_link(init_arg) do
    DynamicSupervisor.start_link(__MODULE__, init_arg, name: __MODULE__)
  end

  @impl true
  def init(_init_arg) do
    DynamicSupervisor.init(strategy: :one_for_one)
  end

  def join(pid, book, %Dojo.Disciple{user_id: user_id} = disciple) when is_binary(user_id) do
    topic_str = topic(book)
    # One derivation: user_id comes from DojoWeb.Session.user_id/1 — the
    # name fallback fork is gone (a join without identity should crash here,
    # not register under a colliding display name).
    reg_key = "#{topic_str}:#{user_id}"

    # Try to find existing Table singleton
    case Registry.lookup(Dojo.TableRegistry, reg_key) do
      [{table_pid, _}] ->
        # Table exists — add this LiveView as a watcher
        try do
          Table.add_watcher(table_pid, pid)
          {:ok, table_pid}
        catch
          :exit, {:noproc, _} ->
            # Table died between Registry lookup and our call — start fresh
            start_table(pid, topic_str, disciple, reg_key)
        end

      [] ->
        start_table(pid, topic_str, disciple, reg_key)
    end
  end

  def join!(pid, book, disciple) do
    {:ok, class} = join(pid, book, disciple)
    class
  end

  defp start_table(pid, topic_str, disciple, reg_key) do
    spec = %{
      id: Table,
      restart: :temporary,
      start:
        {Table, :start_link,
         [%{track_pid: pid, topic: topic_str, disciple: disciple, reg_key: reg_key}]}
    }

    case DynamicSupervisor.start_child(
           {:via, PartitionSupervisor, {__MODULE__, pid}},
           spec
         ) do
      {:ok, table_pid} ->
        {:ok, table_pid}

      # Race condition: another tab started it between our lookup and start
      {:error, {:already_started, table_pid}} ->
        Table.add_watcher(table_pid, pid)
        {:ok, table_pid}

      other ->
        other
    end
  end

  ## helper fns

  def whereis(username, book) do
    Dojo.Gate.get_by_key(topic(book), username)
  end

  def list_disciples(book) do
    Dojo.Gate.list_users(topic(book))
    |> Enum.into(%{}, fn dis -> {Dojo.Disciple.reg_key(dis), dis} end)
  end

  def listen(book) do
    Dojo.PubSub.subscribe(topic(book))
  end

  defp topic(book) do
    "class:" <> book
  end
end
