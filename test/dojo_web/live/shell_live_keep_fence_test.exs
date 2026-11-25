defmodule DojoWeb.ShellLiveKeepFenceTest do
  @moduledoc """
  A delivered old-hand continuation is admitted and settled, but its ephemeral
  current:false hint suppresses the live Table keep pointer. Active/absent-hint
  behavior stays legacy.
  """
  use Dojo.DataCase

  import Ecto.Query

  alias Dojo.Keep
  alias Dojo.Keep.Repo
  alias DojoWeb.Session
  alias DojoWeb.ShellLive
  alias Phoenix.LiveView.Socket

  @author "11111111-2222-3333-4444-555555555555"
  @old_target String.duplicate("b", 64)

  defp start_table(topic, key) do
    start_supervised!(
      {Dojo.Table,
       %{
         track_pid: self(),
         topic: topic,
         disciple: %Dojo.Disciple{name: "wren", author_id: @author, action: "active"},
         reg_key: key
       }},
      id: key,
      restart: :temporary
    )
  end

  defp socket(table, topic) do
    %Socket{
      assigns: %{
        __changed__: %{},
        class: table,
        clan: topic,
        outershell: %DojoWeb.ShellLive.OuterShell{},
        session: %Session{id: @author, name: "wren"}
      }
    }
  end

  defp keep_meta(topic, key) do
    Enum.find_value(Dojo.Gate.list(topic), %{}, fn
      {^key, meta} -> meta
      %{reg_key: ^key} = meta -> meta
      _ -> nil
    end)
  end

  defp signed(message, identity) do
    %{
      "id" => Keep.hash(message),
      "message" => message,
      "proof" => Dojo.KeepSigning.proof(message, identity)
    }
  end

  defp origin(identity, t, title) do
    signed(
      Jason.encode!(%{
        "v" => 1,
        "kind" => "snap",
        "root" => identity.root,
        "ts" => %{"t" => 1_700_000_000_000 + t, "n" => 0},
        "title" => title
      }),
      identity
    )
  end

  defp child(identity, target, t, title) do
    signed(
      Jason.encode!(%{
        "v" => 1,
        "kind" => "snap",
        "root" => identity.root,
        "target" => target,
        "ts" => %{"t" => 1_700_000_000_000 + t, "n" => 0},
        "title" => title
      }),
      identity
    )
  end

  defp payload(root, target, t) do
    message =
      Jason.encode!(%{
        "v" => 1,
        "kind" => "snap",
        "root" => root,
        "target" => target,
        "ts" => %{"t" => 1_700_000_000_000 + t, "n" => 0},
        "title" => "old continuation"
      })

    Dojo.KeepSigning.sign(%{"id" => Keep.hash(message), "message" => message})
  end

  test "prior-hand delivery stores and acks without retargeting the live pointer" do
    r1 = Dojo.KeepSigning.identity("m3-fence-r1")
    r2 = Dojo.KeepSigning.identity("m3-fence-r2")
    topic = "class:shell:KeepFence#{System.unique_integer([:positive])}"
    key = "#{topic}:#{@author}"
    table = start_table(topic, key)
    sock = socket(table, topic)

    {:reply, %{id: origin1, target: nil}, _} =
      ShellLive.handle_event("keep", origin(r1, 1, "R1 origin"), sock)

    {:reply, %{id: origin2, target: nil}, _} =
      ShellLive.handle_event("keep", origin(r2, 2, "R2 origin"), sock)

    assert Keep.owner_of(origin1) == r1.root
    assert Keep.owner_of(origin2) == r2.root

    Dojo.Table.change_meta(table, {:keep, origin2})
    assert keep_meta(topic, key)[:keep] == origin2
    assert Keep.owner_of(keep_meta(topic, key)[:keep]) == r2.root

    prior = Map.put(child(r1, origin1, 3, "R1 child"), "current", false)

    assert {:reply, %{id: id} = fact, _socket} =
             ShellLive.handle_event("keep", prior, sock)

    assert %{id: ^id} = fact

    assert Repo.one(from(k in "keeps", where: k.id == ^id, select: k.id)) == id,
           "the old-root continuation was admitted and stored"

    assert keep_meta(topic, key)[:keep] == origin2,
           "current:false suppresses only the live Table pointer"

    assert Keep.owner_of(keep_meta(topic, key)[:keep]) == r2.root

    absent = Map.delete(prior, "current")
    assert {:reply, %{id: id2}, _socket} = ShellLive.handle_event("keep", absent, sock)
    assert id2 == id
    assert keep_meta(topic, key)[:keep] == origin1
    assert Keep.owner_of(keep_meta(topic, key)[:keep]) == r1.root

    Dojo.Table.change_meta(table, {:keep, origin2})
    explicit = Map.put(prior, "current", true)
    assert {:reply, %{id: id3}, _socket} = ShellLive.handle_event("keep", explicit, sock)
    assert id3 == id
    assert keep_meta(topic, key)[:keep] == origin1
    assert Keep.owner_of(keep_meta(topic, key)[:keep]) == r1.root
  end

  test "no hint preserves the existing live publication" do
    root = Dojo.KeepSigning.root(String.duplicate("f", 64))
    topic = "class:shell:KeepHint#{System.unique_integer([:positive])}"
    key = "#{topic}:#{@author}"
    table = start_table(topic, key)
    sock = socket(table, topic)

    assert {:reply, %{id: id, target: @old_target}, _socket} =
             ShellLive.handle_event("keep", payload(root, @old_target, 1), sock)

    assert Repo.one(from(k in "keeps", where: k.id == ^id, select: k.id)) == id
    assert keep_meta(topic, key)[:keep] == @old_target
  end
end
