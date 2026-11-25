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

  # Bounds the teardown-race retry loop (lookup → dying table → start fresh →
  # someone else's table already dying → …). In practice resolves in one hop;
  # the cap only fires under pathological churn.
  @max_join_retries 3

  def join(pid, book, %Dojo.Disciple{author_id: author_id} = disciple)
      when is_binary(author_id) do
    topic_str = topic(book)
    # One derivation: author_id comes from DojoWeb.Session.author_id/1
    # (id:ki-mint / id:ki-presence). A join without identity crashes here,
    # not under a colliding display name. Tracker key is reg_key, never name.
    reg_key = "#{topic_str}:#{author_id}"

    attach(pid, topic_str, disciple, reg_key, @max_join_retries)
  end

  def join!(pid, book, disciple) do
    {:ok, class} = join(pid, book, disciple)
    class
  end

  # Resolve the singleton Table for reg_key and attach pid as a watcher.
  # A Table self-stops when its last watcher leaves (Table.handle_info :DOWN →
  # {:stop, :normal, ...}); Registry can still hand back that dying pid, so any
  # attach may land mid-teardown. We treat "table gone" uniformly — whether it
  # was already dead or died during our call — and start fresh.
  defp attach(_pid, _topic_str, _disciple, reg_key, 0) do
    {:error, {:join_retries_exhausted, reg_key}}
  end

  defp attach(pid, topic_str, disciple, reg_key, retries) do
    case Registry.lookup(Dojo.TableRegistry, reg_key) do
      [{table_pid, _}] ->
        case try_add_watcher(table_pid, pid) do
          :ok -> {:ok, table_pid}
          :gone -> start_table(pid, topic_str, disciple, reg_key, retries)
        end

      [] ->
        start_table(pid, topic_str, disciple, reg_key, retries)
    end
  end

  # Attempt to attach as a watcher, tolerating the teardown race. Returns :ok,
  # or :gone if the Table terminated out from under us — already dead (:noproc)
  # or dying mid-call with a graceful reason (:normal / :shutdown). Genuine
  # failures (timeout, :killed) propagate; they are not the race.
  defp try_add_watcher(table_pid, pid) do
    Table.add_watcher(table_pid, pid)
    :ok
  catch
    :exit, {reason, _} when reason in [:noproc, :normal, :shutdown] -> :gone
    :exit, {{:shutdown, _}, _} -> :gone
  end

  defp start_table(pid, topic_str, disciple, reg_key, retries) do
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

      # Race: another tab won the Registry name between our lookup and start.
      # Attach to the winner — but that one can also be tearing down, so route
      # a teardown exit back through a fresh lookup with one fewer retry.
      {:error, {:already_started, table_pid}} ->
        case try_add_watcher(table_pid, pid) do
          :ok -> {:ok, table_pid}
          :gone -> attach(pid, topic_str, disciple, reg_key, retries - 1)
        end

      other ->
        other
    end
  end

  ## helper fns

  def whereis(reg_key, book) when is_binary(reg_key) do
    Dojo.Gate.get_by_key(topic(book), reg_key)
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
