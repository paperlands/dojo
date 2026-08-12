defmodule Dojo.Keep do
  @moduledoc """
  Server half of the keep (id:kb-11 · id:kb-12). No Ecto schema/changeset.

  * `project/2` — derive columns; accept none (id:kb-11-derive)
  * `receive/2` — project → bind → stamp → insert → row fact (id:kb-12)
  * `image/2` — referent after the fact (id:kb-12a)

  Frozen entry fields: v · kind · root · ts · target. `clan` is wire fact.

  Referents (id:kb-vet5-referent): source is hash(text) — verifiable, no fence;
  image is the message id — fenced by the bind, first-write-wins.
  """

  import Ecto.Query
  require Logger

  alias Dojo.Keep.Repo
  alias Dojo.Keep.Repo.Reader

  @type cols :: %{
          id: String.t(),
          root: String.t(),
          kind: String.t(),
          target: String.t() | nil,
          ts_t: integer(),
          ts_n: integer(),
          message: String.t()
        }

  @type reason :: :unparseable | :shape | :name | :root | :too_big

  # The keeps table columns — STRICT migration is the schema; this is the
  # one map both insert_all and tests build. Not an Ecto schema, not a
  # changeset (id:kb-11). image last: queries that omit it skip blob pages.
  @keep_cols ~w(id clan root kind target ts_t ts_n message shared_at shared_node inserted_at image)a

  # Ceilings: footprint (~15× measured) + latency (one writer stalls the room).
  # Measured: msg ~298 B, source ~850 B, image ~17 KB (id:kb-source).
  @max_text 256 * 1024
  @max_image 256 * 1024

  # One ship → one fact (id:kb-12). Shared: target; refused: why; silence: nil.
  @type fact :: %{id: String.t(), at: integer(), node: String.t(), target: String.t() | nil}
  @type refusal :: %{id: String.t(), at: integer(), node: String.t(), why: reason()}
  @type reply :: fact() | refusal() | nil

  # ── project (pure) ───────────────────────────────────────────────────

  @doc """
  Project message → row columns. Id is a claim; name is derived (mismatch → `:name`).
  Pure.
  """
  @spec project(String.t(), String.t()) :: {:ok, cols()} | {:error, :unparseable | :shape | :name}
  def project(message, claimed_id)
      when is_binary(message) and is_binary(claimed_id) do
    with {:ok, e} <- decode(message),
         :ok <- shaped?(e),
         id = hash(message),
         :ok <- name_matches?(id, claimed_id) do
      {:ok,
       %{
         id: id,
         root: e["root"],
         kind: e["kind"],
         target: e["target"],
         ts_t: e["ts"]["t"],
         ts_n: e["ts"]["n"],
         message: message
       }}
    end
  end

  def project(_, _), do: {:error, :shape}

  @doc """
  The name of the bytes — SHA-256 hex64, lowercase (id:kc-law 3, id:kb-1).
  Same engine the client uses; same string on both sides of the wire.
  """
  @spec hash(String.t()) :: String.t()
  def hash(text) when is_binary(text) do
    :crypto.hash(:sha256, text) |> Base.encode16(case: :lower)
  end

  # ── receive (one ship) ───────────────────────────────────────────────

  @doc """
  One ship (id:kb-12): project → bind (TOFU) → stamp → insert → **row** fact.

  Permanent refusals are answers (stamped + why). Silence is nil. Source lands
  in the same transaction (id:kb-source-absence); key is `hash(text)`, never
  from the message.

  Options: `:clan` (required), `:author_id` (recorded, not compared).
  """
  @spec receive(map(), keyword()) :: reply()
  def receive(%{"id" => id, "message" => message} = payload, opts)
      when is_binary(id) and is_binary(message) do
    clan = Keyword.fetch!(opts, :clan)
    author_id = Keyword.fetch!(opts, :author_id)

    with :ok <- within(message, @max_text),
         {:ok, source} <- referent(payload["source"]),
         {:ok, cols} <- project(message, id) do
      admit(cols, source, clan, author_id)
    else
      {:error, why} -> refuse(id, why)
    end
  end

  def receive(%{"id" => id}, _opts) when is_binary(id), do: refuse(id, :shape)
  def receive(_, _), do: silence()

  # ── private: receive path ────────────────────────────────────────────

  defp admit(cols, source, clan, author_id) do
    %{at: at, node: node} = stamp()

    case bind(cols.root, clan, author_id, at) do
      :ok ->
        # One transaction: a message pointing at a source that is not there
        # is a tombstone (id:kb-source-keys — when two stores hold one fact,
        # one transaction holds them).
        Repo.transact(fn ->
          put_source(source)
          put_keep(cols, clan, at, node)
          {:ok, cols.id}
        end)

        case fact_of(cols.id) do
          %{} = fact -> fact
          # Insert vanished — pool blip, not an answer.
          nil -> silence()
        end

      :root ->
        note_refuse(cols.id, :root)
        %{id: cols.id, at: at, node: node, why: :root}
    end
  end

  # TOFU: a root belongs to one room. The primary key is the ACL (D017).
  #
  # author_id is RECORDED, never compared (id:kb-vet5-bind): it is derived
  # from a display name, and a rename — or the localStorage wipe the journal
  # is built to survive — would otherwise refuse every later keep of that
  # root forever, stamped as a permanent answer. The root is a continuant;
  # the name is not. When authentication mints the author, the binding rises
  # ABOVE the log and gathers roots; it is never rewritten below it.
  defp bind(root, clan, author_id, at) do
    Repo.insert_all(
      "roots",
      [%{root: root, clan: clan, author_id: author_id, bound_at: at}],
      on_conflict: :nothing,
      conflict_target: :root
    )

    case Repo.one(from(r in "roots", where: r.root == ^root, select: r.clan)) do
      ^clan -> :ok
      _ -> :root
    end
  end

  # Content-addressed, so it needs no fence and no read-back: identical text
  # lands under an identical name (id:kb-vet5-referent). The key is DERIVED —
  # the message's own source_id is never read, which would be a sixth field.
  defp put_source(nil), do: :ok

  defp put_source(text) do
    Repo.insert_all("sources", [%{id: hash(text), text: text}],
      on_conflict: :nothing,
      conflict_target: :id
    )

    :ok
  end

  @doc """
  The keeps row for `insert_all` — columns only, not a schema (id:kb-11).

  Built once from projected cols + the wire stamp. Tests use the same
  builder so a second hand-written map cannot drift.
  """
  @spec row(cols(), String.t(), integer() | nil, String.t() | nil) :: map()
  def row(%{} = cols, clan, at, node) when is_binary(clan) do
    %{
      id: cols.id,
      clan: clan,
      root: cols.root,
      kind: cols.kind,
      target: cols.target,
      ts_t: cols.ts_t,
      ts_n: cols.ts_n,
      message: cols.message,
      shared_at: at,
      shared_node: node,
      inserted_at: DateTime.utc_now(:millisecond) |> DateTime.to_iso8601(),
      image: nil
    }
  end

  @doc "Column atoms the STRICT `keeps` table holds — one list, the map's keys."
  @spec keep_cols() :: [atom()]
  def keep_cols, do: @keep_cols

  defp put_keep(cols, clan, at, node) do
    Repo.insert_all("keeps", [row(cols, clan, at, node)],
      on_conflict: :nothing,
      conflict_target: :id
    )
  end

  # The reply is the row's fact (id:kb-vet3 26) — ship twice is once for the
  # reply too, not only the disk. target rides so presence holds a continuant.
  # Read pool: the insert already committed (id:kb-10).
  defp fact_of(id) do
    Reader.one(
      from(k in "keeps",
        where: k.id == ^id,
        select: %{id: k.id, at: k.shared_at, node: k.shared_node, target: k.target}
      )
    )
  end

  # ── image (the referent that follows the fact) ───────────────────────

  @doc """
  Fill a shared keep's picture, once (id:kb-12a).

  Fire and forget on the wire, so there is no reply to design: it lands or it
  does not, and a lost picture degrades to re-running the turtle — never to a
  hole (id:kc-e-missing-image).

  `image IS NULL` is what makes this a fact rather than a write: a second
  arrival of the same picture changes nothing. `clan` is the fence, and its
  subject is the bind's subject (id:kb-vet5-bind) — a member of the room that
  holds the keep may fill it, and the emptiness makes the first one final.
  When the minted author arrives, this one predicate sharpens with the bind.

  ## Options

    * `:clan` — fact of the wire (required)
  """
  @spec image(map(), keyword()) :: :ok | {:error, reason()}
  def image(%{"id" => id, "image" => encoded}, opts)
      when is_binary(id) and is_binary(encoded) do
    clan = Keyword.fetch!(opts, :clan)

    with :ok <- within(encoded, @max_image),
         {:ok, bytes} <- decode64(encoded) do
      # STRICT refuses TEXT in a BLOB column, and a schemaless query has no
      # schema to infer from — so the type is said out loud. The disk holding
      # us to it is the belt working (id:kb-11).
      from(k in "keeps",
        where: k.id == ^id and k.clan == ^clan and is_nil(k.image),
        update: [set: [image: type(^bytes, :binary)]]
      )
      |> Repo.update_all([])

      :ok
    else
      {:error, why} ->
        note_refuse(id, why)
        {:error, why}
    end
  end

  def image(_, _), do: {:error, :shape}

  # ── pull (the read half of the fork word) ────────────────────────────

  @doc """
  One keep, read back for a visitor (id:la-fork-pull).

  The ref wears two faces — the same ladder the client walks (id:la-fork):
  a keep's id, else a work's id, answered with the newest keep of that work —
  the HEAD of the chain, by the author's own order (id:kb-8). The source
  rides beside the message (id:kb-source-absence); absent, the answer is
  honestly a tombstone.

  This answer carries no authority: the reader verifies the name
  (id:kc-law 3), so wrong bytes land under a different name and are refused
  at the client.

  ## Single-machine (id:kb-10)

  WAL is single-machine by physics — processes must share memory. This door
  reads the local file only. Correctness depends on one machine owning the
  volume (`fly scale count 1`; see fly.toml mounts). Scale past one and
  half the traffic 404s with no error — the constraint lives at this door,
  not only in a deploy comment.
  """
  @spec pull(String.t()) :: {:ok, map()} | :none
  def pull(ref) when is_binary(ref) do
    if ref =~ ~r/^[0-9a-f]{64}$/ do
      case by_id(ref) || head_of(ref) do
        nil ->
          :none

        row ->
          {:ok,
           %{
             id: row.id,
             message: row.message,
             source: source_of(row.message),
             at: row.at,
             node: row.node
           }}
      end
    else
      :none
    end
  end

  def pull(_), do: :none

  # Pull half lives on the read pool (id:kb-10) — WAL readers, not the writer.
  defp by_id(id) do
    Reader.one(
      from(k in "keeps",
        where: k.id == ^id,
        select: %{id: k.id, message: k.message, at: k.shared_at, node: k.shared_node}
      )
    )
  end

  defp head_of(target) do
    Reader.one(
      from(k in "keeps",
        where: k.target == ^target,
        order_by: [desc: k.ts_t, desc: k.ts_n],
        limit: 1,
        select: %{id: k.id, message: k.message, at: k.shared_at, node: k.shared_node}
      )
    )
  end

  # Read-side fold only — the WRITE path never reads source_id (id:kb-11-derive
  # stands). hash(text) == source_id by construction; missing → tombstone.
  defp source_of(message) do
    with {:ok, e} <- decode(message),
         sid when is_binary(sid) <- Map.get(e, "source_id"),
         text when is_binary(text) <-
           Reader.one(from(s in "sources", where: s.id == ^sid, select: s.text)) do
      text
    else
      _ -> nil
    end
  end

  defp decode64(encoded) do
    case Base.decode64(encoded) do
      {:ok, bytes} -> {:ok, bytes}
      :error -> {:error, :unparseable}
    end
  end

  # ── private: the ceiling ─────────────────────────────────────────────

  # One sentence for the message and both referents (id:kb-vet5-referent).
  defp within(text, max) when byte_size(text) <= max, do: :ok
  defp within(_, _), do: {:error, :too_big}

  defp referent(nil), do: {:ok, nil}

  defp referent(text) when is_binary(text),
    do: with(:ok <- within(text, @max_text), do: {:ok, text})

  defp referent(_), do: {:error, :shape}

  defp refuse(id, why) do
    %{at: at, node: node} = stamp()
    note_refuse(id, why)
    %{id: id, at: at, node: node, why: why}
  end

  defp silence, do: nil

  defp stamp do
    %{at: System.system_time(:millisecond), node: node_name()}
  end

  defp node_name do
    try do
      :partisan.node() |> to_string()
    catch
      _, _ -> Node.self() |> to_string()
    end
  end

  # why is for us, not the journal (id:kc-c-shared).
  defp note_refuse(id, why) do
    Logger.debug(fn -> ["keep refuse ", id, " ", Atom.to_string(why)] end)
  end

  # ── private: project ─────────────────────────────────────────────────

  # THE PROJECTION FLOOR as data (id:kb-5-floor). entry.unshaped walks the
  # same file. Two hand-written predicates diverged once (id:kb-vet5 42);
  # one table cannot. @external_resource recompiles this module when the
  # table changes.
  @floor_path Path.expand("../../assets/js/keep/floor.json", __DIR__)
  @external_resource @floor_path
  @floor @floor_path |> File.read!() |> Jason.decode!()

  defp decode(message) do
    case Jason.decode(message) do
      {:ok, %{} = e} -> {:ok, e}
      {:ok, _} -> {:error, :unparseable}
      {:error, _} -> {:error, :unparseable}
    end
  end

  # Five frozen fields, right types. Meaning is never judged (id:kc-c-room).
  # The law is @floor; this is its interpreter — the twin of entry.unshaped.
  # A ts that will never project is a permanent refusal — the server orders
  # by the column it derives (id:kb-11-derive). Caller has already decoded a map.
  defp shaped?(e) when is_map(e) do
    Enum.reduce_while(@floor, :ok, fn %{"field" => field, "type" => type}, :ok ->
      if type_ok?(fetch_path(e, field), type),
        do: {:cont, :ok},
        else: {:halt, {:error, :shape}}
    end)
  end

  # Present-or-missing, never null-as-absent: target may be JSON null and
  # that is lawful; a missing key is not (id:kc-r-absence).
  defp fetch_path(e, path) do
    path
    |> String.split(".")
    |> Enum.reduce_while({:ok, e}, fn
      key, {:ok, %{} = m} ->
        case Map.fetch(m, key) do
          {:ok, v} -> {:cont, {:ok, v}}
          :error -> {:halt, :missing}
        end

      _key, _ ->
        {:halt, :missing}
    end)
  end

  # The table's four type tags — vocabulary only; which fields wear which
  # lives solely in floor.json.
  defp type_ok?({:ok, v}, "string") when is_binary(v), do: true
  defp type_ok?({:ok, v}, "string|null") when is_binary(v) or is_nil(v), do: true
  defp type_ok?({:ok, v}, "nonneg_int") when is_integer(v) and v >= 0, do: true
  defp type_ok?({:ok, v}, "int>=1") when is_integer(v) and v >= 1, do: true

  defp type_ok?(_, type)
       when type in ~w(string string|null nonneg_int int>=1),
       do: false

  defp type_ok?(_, type), do: raise("unknown floor type: #{type}")

  defp name_matches?(id, claimed) when id == claimed, do: :ok
  defp name_matches?(_, _), do: {:error, :name}
end
