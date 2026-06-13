defmodule Dojo.IdentityTest do
  # One Address, backend half — Phase 1b (specs/decisions/007).
  # The user_id mint lives in one place; presence meta carries reg_key and
  # node as separate fields; readers stay tolerant of legacy embedded tuples.
  use ExUnit.Case, async: true

  alias DojoWeb.Session
  alias Dojo.Disciple

  describe "Session.user_id/1 — the one mint" do
    test "derives a stable alphanumeric identity from name + first-login time" do
      session = %Session{name: "kai", last_opened: ~U[2026-06-10 00:00:00Z]}
      id = Session.user_id(session)
      assert id =~ ~r/^[a-zA-Z0-9]+$/
      assert String.starts_with?(id, "kai")
      assert Session.user_id(session) == id, "same session, same identity"
    end

    test "different first-login times yield different identities for one name" do
      a = Session.user_id(%Session{name: "kai", last_opened: ~U[2026-06-10 00:00:00Z]})
      b = Session.user_id(%Session{name: "kai", last_opened: ~U[2026-06-10 00:00:01Z]})
      refute a == b
    end

    test "refuses a session without a name" do
      assert_raise FunctionClauseError, fn ->
        Session.user_id(%Session{name: nil})
      end
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
      assert_raise FunctionClauseError, fn -> Disciple.reg_key(%{name: "kai"}) end
      assert_raise FunctionClauseError, fn -> Disciple.table_address(%{name: "kai"}) end
    end
  end

  describe "Class.join/3 — identity required" do
    test "a join without user_id crashes at the door" do
      assert_raise FunctionClauseError, fn ->
        Dojo.Class.join(self(), "test-identity", %Disciple{name: "kai", user_id: nil})
      end
    end
  end
end
