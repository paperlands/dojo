defmodule Dojo.Keep.ProjectTest do
  @moduledoc """
  Pure projection tests (id:kb-11-derive). No repo, no sandbox, no mocks —
  the Elixir mirror of entry.read + name.
  """
  use ExUnit.Case, async: true

  alias Dojo.Keep

  @root String.duplicate("a", 64)
  @target String.duplicate("b", 64)
  @ts %{"t" => 1_700_000_000_000, "n" => 0}

  defp message(overrides \\ %{}) do
    base = %{
      "source_id" => "deadbeef",
      "title" => "hello",
      "v" => 1,
      "kind" => "snap",
      "root" => @root,
      "ts" => @ts,
      "target" => @target
    }

    Jason.encode!(Map.merge(base, overrides))
  end

  describe "project/2 — derive, never accept" do
    test "honest pair → columns from the message, id is hash(message)" do
      bytes = message()
      id = Keep.hash(bytes)

      assert {:ok, cols} = Keep.project(bytes, id)
      assert cols.id == id
      assert cols.root == @root
      assert cols.kind == "snap"
      assert cols.target == @target
      assert cols.ts_t == 1_700_000_000_000
      assert cols.ts_n == 0
      # Verbatim — re-serializing would change the name (id:kc-c-pure).
      assert cols.message == bytes
    end

    test "shared is not the name — hash is byte-identical after any round trip of the string" do
      bytes = message()
      id = Keep.hash(bytes)
      assert Keep.hash(bytes) == id
      assert {:ok, %{id: ^id}} = Keep.project(bytes, id)
    end

    test "null target is lawful — a keep about no work yet" do
      bytes = message(%{"target" => nil})
      id = Keep.hash(bytes)
      assert {:ok, %{target: nil}} = Keep.project(bytes, id)
    end

    test "unknown free fields pass — meaning is never judged" do
      bytes = message(%{"invented_today" => true})
      id = Keep.hash(bytes)
      assert {:ok, %{kind: "snap"}} = Keep.project(bytes, id)
    end

    test "unknown kind is shared shape — meaning is never judged" do
      bytes = message(%{"kind" => "invented-today"})
      id = Keep.hash(bytes)
      assert {:ok, %{kind: "invented-today"}} = Keep.project(bytes, id)
    end
  end

  describe "project/2 — permanent refusals" do
    test "garbage JSON → :unparseable" do
      assert Keep.project("{not json", "x") == {:error, :unparseable}
    end

    test "non-object JSON → :unparseable" do
      assert Keep.project("[1,2,3]", "x") == {:error, :unparseable}
    end

    test "missing root → :shape" do
      bytes =
        Jason.encode!(%{
          "v" => 1,
          "kind" => "snap",
          "ts" => @ts,
          "target" => @target
        })

      assert Keep.project(bytes, Keep.hash(bytes)) == {:error, :shape}
    end

    test "null root → :shape (will never project into the index)" do
      bytes = message(%{"root" => nil})
      assert Keep.project(bytes, Keep.hash(bytes)) == {:error, :shape}
    end

    test "non-string root → :shape" do
      bytes = message(%{"root" => 42})
      assert Keep.project(bytes, Keep.hash(bytes)) == {:error, :shape}
    end

    test "missing ts → :shape" do
      bytes =
        Jason.encode!(%{
          "v" => 1,
          "kind" => "snap",
          "root" => @root,
          "target" => @target
        })

      assert Keep.project(bytes, Keep.hash(bytes)) == {:error, :shape}
    end

    test "ts with non-number halves → :shape" do
      bytes = message(%{"ts" => %{"t" => "soon", "n" => 0}})
      assert Keep.project(bytes, Keep.hash(bytes)) == {:error, :shape}
    end

    test "missing kind → :shape" do
      bytes =
        Jason.encode!(%{
          "v" => 1,
          "root" => @root,
          "ts" => @ts,
          "target" => @target
        })

      assert Keep.project(bytes, Keep.hash(bytes)) == {:error, :shape}
    end

    test "missing target key → :shape (five keys always)" do
      bytes =
        Jason.encode!(%{
          "v" => 1,
          "kind" => "snap",
          "root" => @root,
          "ts" => @ts
        })

      assert Keep.project(bytes, Keep.hash(bytes)) == {:error, :shape}
    end

    test "claimed id ≠ hash(message) → :name (anti-divergence)" do
      bytes = message()
      assert Keep.project(bytes, String.duplicate("0", 64)) == {:error, :name}
    end

    test "non-binary args → :shape" do
      assert Keep.project(nil, "x") == {:error, :shape}
      assert Keep.project("{}", nil) == {:error, :shape}
    end
  end

  describe "hash/1 — matches the client engine" do
    test "empty string is the NIST vector" do
      # FIPS 180-4 empty message
      assert Keep.hash("") ==
               "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    end

    test "abc is the NIST vector" do
      assert Keep.hash("abc") ==
               "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    end

    test "64 lowercase hex digits" do
      assert Keep.hash("hello") =~ ~r/^[0-9a-f]{64}$/
    end
  end

  describe "the projection floor — one table, both sides of the wire" do
    # floor.json is the law; keep_floor.json is the cases. This suite and
    # entry_test.mjs walk the same cases against interpreters of the same
    # table — floor divergence is impossible by construction (id:kb-vet5 42).

    test "the table is one file both interpreters walk" do
      path = "assets/js/keep/floor.json"
      assert File.exists?(path)
      floor = path |> File.read!() |> Jason.decode!()

      assert Enum.map(floor, & &1["field"]) == ~w(root kind target ts.t ts.n v)

      for row <- floor do
        assert is_binary(row["type"]) and row["type"] != ""
      end

      # shaped? is driven by the table, not hand-coded field_* clauses.
      src = File.read!("lib/dojo/keep.ex")
      assert src =~ "floor.json"
      assert src =~ "@external_resource"
      refute src =~ "defp field_string"
      refute src =~ "defp field_ts"
      refute src =~ "defp field_v"
    end

    for c <- "test/fixtures/keep_floor.json" |> File.read!() |> Jason.decode!() do
      @case c

      test "#{c["note"]}" do
        message = Jason.encode!(@case["value"])
        result = Keep.project(message, Keep.hash(message))

        case @case["why"] do
          nil ->
            assert {:ok, _} = result,
                   "the client stores this; the clan must accept it"

          field ->
            assert {:error, :shape} = result,
                   "the client refuses this on #{field}; the clan must too"
        end
      end
    end
  end

  describe "structural — five frozen fields, no others" do
    test "the floor table names the five catalog keys; project promotes four" do
      # id:kc-verify / id:kb-11: the five frozen fields live in floor.json.
      # project promotes root/kind/target/ts (as ts_t/ts_n); v is the fold
      # floor, never a column. clan is a wire fact, never an entry field.
      floor = "assets/js/keep/floor.json" |> File.read!() |> Jason.decode!()

      fields =
        floor
        |> Enum.map(& &1["field"])
        |> Enum.map(&(String.split(&1, ".") |> hd()))
        |> Enum.uniq()

      assert Enum.sort(fields) == Enum.sort(~w(kind root target ts v))

      src = File.read!("lib/dojo/keep.ex")

      # The promoted columns still read from the message map.
      for key <- ~w(kind root target) do
        assert src =~ ~s["#{key}"], "expected frozen field #{key} to be projected"
      end

      assert src =~ ~s["ts"]

      # clan must not be read from the message
      refute src =~ ~s|e["clan"]|, "clan is a wire fact, never an entry field"
      refute src =~ ~s|e["title"]|, "title is free body, never a promoted column"
      refute src =~ ~s|e["source"]|, "source is free body"
    end
  end
end
