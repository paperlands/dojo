defmodule Dojo.IdentityTest do
  # One Address, backend half — person key is Session.author_id/1 (id:ki-mint).
  # Presence meta carries reg_key and node as separate fields; readers stay
  # tolerant of legacy embedded tuples. Amends D007.
  use ExUnit.Case, async: true

  alias DojoWeb.Session
  alias Dojo.Disciple

  describe "Session.author_id/1 — the person key (id:ki-mint)" do
    test "returns the session UUID" do
      id = Ecto.UUID.generate()
      session = %Session{name: "kai", id: id}
      assert Session.author_id(session) == id
      assert Session.author_id(session) == Session.author_id(session)
    end

    test "is independent of the display name" do
      id = Ecto.UUID.generate()
      a = Session.author_id(%Session{name: "kai", id: id})
      b = Session.author_id(%Session{name: "alice", id: id})
      assert a == b
    end

    test "refuses a session without a UUID id" do
      assert_raise FunctionClauseError, fn ->
        apply(Session, :author_id, [%Session{name: "kai", id: nil}])
      end

      assert_raise CaseClauseError, fn ->
        apply(Session, :author_id, [%Session{name: "kai", id: "not-a-uuid"}])
      end
    end
  end

  describe "Session.ensure_author_id/1 — keep or repair (id:ki-mint)" do
    test "keeps a good UUID" do
      id = Ecto.UUID.generate()
      {session, :kept} = Session.ensure_author_id(%Session{id: id, name: "kai"})
      assert session.id == id
    end

    test "repairs a missing or garbage id" do
      {session, :repaired} = Session.ensure_author_id(%Session{id: nil, name: "kai"})
      assert {:ok, _} = Ecto.UUID.cast(session.id)

      {session2, :repaired} = Session.ensure_author_id(%Session{id: "garbage", name: "kai"})
      assert {:ok, _} = Ecto.UUID.cast(session2.id)
      refute session2.id == "garbage"
    end

    test "rename does not rotate the person key" do
      id = Ecto.UUID.generate()
      session = %Session{id: id, name: "kai"}
      assert Session.author_id(session) == id
      assert Session.author_id(%{session | name: "alice"}) == id

      {kept, :kept} = Session.ensure_author_id(%{session | name: "alice"})
      assert kept.id == id
    end
  end

  describe "Disciple meta readers — one composition rule, legacy-tolerant" do
    test "reg_key reads the meta field" do
      assert Disciple.reg_key(%{reg_key: "class:shell:PaperLand:kai123", node: :n1}) ==
               "class:shell:PaperLand:kai123"
    end

    test "reg_key falls back to the legacy embedded tuple" do
      assert Disciple.reg_key(%{node: {"class:shell:PaperLand:kai123", :n1}}) ==
               "class:shell:PaperLand:kai123"
    end

    test "table_address composes {reg_key, node} from separate fields" do
      assert Disciple.table_address(%{reg_key: "rk", node: :dojo@host}) == {"rk", :dojo@host}
    end

    test "table_address unpacks the legacy embedded tuple" do
      assert Disciple.table_address(%{node: {"rk", :dojo@host}}) == {"rk", :dojo@host}
    end

    test "an addressless meta crashes loudly, not silently" do
      assert_raise FunctionClauseError, fn -> apply(Disciple, :reg_key, [%{name: "kai"}]) end

      assert_raise FunctionClauseError, fn ->
        apply(Disciple, :table_address, [%{name: "kai"}])
      end
    end
  end

  describe "Class.join/3 — identity required" do
    test "a join without author_id crashes at the door" do
      assert_raise FunctionClauseError, fn ->
        apply(Dojo.Class, :join, [
          self(),
          "test-identity",
          %Disciple{name: "kai", author_id: nil}
        ])
      end
    end
  end
end
