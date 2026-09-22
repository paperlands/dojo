defmodule Dojo.Keep do
  @moduledoc """
  Server half of the keep kernel. No Ecto schema/changeset.

  `project/2` → columns. `receive/2` is not a verb (keep-cut). Pre-cut still
  wears `roots` / `authors` / `works` / `keeps.clan`. Do not add callers.

  Name = hash(message). Shared = `{at, node}` beside the row.
  `pull/1` is still overloaded — land keep-cut III (`get` is get).
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

  @type reason :: :unparseable | :shape | :name | :root | :work | :too_big

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
         # whose journal · what sort · what about · when (t) · which (n)
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
  Pre-cut ship. Not a kernel verb. Bind is frozen, not law (keep-cut).
  """
  @spec receive(map(), keyword()) :: reply()
  def receive(%{"id" => id, "message" => message} = payload, opts)
      when is_binary(id) and is_binary(message) do
    clan = Keyword.fetch!(opts, :clan)
    author_id = Keyword.fetch!(opts, :author_id)

    with :ok <- within(message, @max_text),
         {:ok, source} <- referent(payload["source"]),
         {:ok, image} <- picture(payload["image"]),
         {:ok, cols} <- project(message, id) do
      admit(cols, source, image, clan, author_id)
    else
      {:error, why} -> refuse(id, why)
    end
  end

  def receive(%{"id" => id}, _opts) when is_binary(id), do: refuse(id, :shape)
  def receive(_, _), do: silence()

  # ── private: receive path ────────────────────────────────────────────

  # Pre-cut binds (keep-cut IV). Frozen.
  defp admit(cols, source, image, clan, author_id) do
    %{at: at, node: node} = stamp()

    # One transaction holds the bindings and the log (id:kb-source-keys) — a
    # `works` or `roots` row outliving a failed keep would be authority the
    # log never gave.
    outcome =
      Repo.transact(fn ->
        with :ok <- bind(cols.root, clan, author_id, at),
             :ok <- bind_work(cols) do
          put_source(source)
          put_keep(cols, clan, at, node, image)
          {:ok, :kept}
        end
      end)

    case outcome do
      {:ok, :kept} ->
        case fact_of(cols.id) do
          %{} = fact -> fact
          # Insert vanished — pool blip, not an answer.
          nil -> silence()
        end

      {:error, why} ->
        note_refuse(cols.id, why)
        %{id: cols.id, at: at, node: node, why: why}
    end
  end

  # Pre-cut TOFU: a root belongs to one room. Frozen — do not grow.
  # author_id is recorded on first insert, never compared, never rewritten.
  # attach/remember withdrawn (keep kernel 2026-09-06). Letters ride the keep.
  defp bind(root, clan, author_id, at) do
    Repo.insert_all(
      "roots",
      [%{root: root, clan: clan, author_id: author_id, bound_at: at}],
      on_conflict: :nothing,
      conflict_target: :root
    )

    case Repo.one(from(r in "roots", where: r.root == ^root, select: r.clan)) do
      ^clan -> :ok
      _ -> {:error, :root}
    end
  end

  # Pre-cut. Do not grow (keep-cut IV).
  @owned_kinds %{"snap" => :work}

  @doc "Pre-cut. Do not grow."
  @spec owned_kinds() :: %{String.t() => :work | :node}
  def owned_kinds, do: @owned_kinds

  # Pre-cut: works table still fences writes. Retracted as law (keep-cut IV).
  # Frozen — do not grow. Origin is the evidence; this is not it.
  defp bind_work(%{target: target, kind: kind, root: root}) do
    if is_binary(target) and @owned_kinds[kind] == :work do
      Repo.insert_all("works", [%{work_id: target, root: root}],
        on_conflict: :nothing,
        conflict_target: :work_id
      )

      case Repo.one(owner_query(target)) do
        ^root -> :ok
        _ -> {:error, :work}
      end
    else
      :ok
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
  Tests use the same builder so a second hand-written map cannot drift.
  """
  @spec row(cols(), String.t(), integer() | nil, String.t() | nil, binary() | nil) :: map()
  def row(cols, clan, at, node, image \\ nil)

  def row(%{} = cols, clan, at, node, image) when is_binary(clan) do
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
      # Schemaless insert_all has no dumper — {:blob, _} is what STRICT wants.
      image: dump_image(image)
    }
  end

  @doc "Column atoms the STRICT `keeps` table holds — one list, the map's keys."
  @spec keep_cols() :: [atom()]
  def keep_cols, do: @keep_cols

  defp put_keep(cols, clan, at, node, image) do
    Repo.insert_all("keeps", [row(cols, clan, at, node, image)],
      on_conflict: :nothing,
      conflict_target: :id
    )
  end

  defp dump_image(nil), do: nil
  defp dump_image(bytes) when is_binary(bytes), do: {:blob, bytes}

  # The reply is the row's share-fact. Read pool after commit.
  defp fact_of(id) do
    Reader.one(
      from(k in "keeps",
        where: k.id == ^id,
        select: %{id: k.id, at: k.shared_at, node: k.shared_node, target: k.target}
      )
    )
  end

  # Pre-cut read doors (keep-cut III). Selectors are not the contract.
  @selectors [:target, :root]
  @page 12
  @page_max 200

  @doc "Pre-cut selectors. Not a kernel verb."
  @spec selectors() :: [:target | :root, ...]
  def selectors, do: @selectors

  defp of(opts) do
    case Keyword.get(opts, :of, :target) do
      sel when sel in @selectors -> sel
      "target" -> :target
      "root" -> :root
      _ -> nil
    end
  end

  defp bound(opts), do: opts |> Keyword.get(:n, @page) |> min(@page_max) |> max(1)

  @doc """
  Pre-cut room fan (keep-cut III). Not a kernel verb.
  """
  @spec latest(String.t(), keyword()) :: {[map()], String.t() | nil}
  def latest(clan, opts \\ [])

  def latest(clan, opts) when is_binary(clan) do
    case of(opts) do
      nil -> {[], nil}
      sel -> clan |> fan(sel) |> except(sel, opts[:except]) |> page(opts, {:room, sel})
    end
  end

  def latest(_, _), do: {[], nil}

  # Pre-cut skip-self by author_id (keep-cut II). Occupancy is root.
  defp except(q, :root, uid) when is_binary(uid),
    do: where(q, [author: r], r.author_id != ^uid)

  defp except(q, _sel, _uid), do: q

  @doc """
  Pre-cut depth page (keep-cut III). Open-work is a fold, not this door.
  """
  @spec history(String.t(), keyword()) :: {[map()], String.t() | nil}
  def history(id, opts \\ [])

  def history(id, opts) when is_binary(id) do
    case {minted?(id), of(opts)} do
      {true, sel} when sel != nil -> id |> depth(sel) |> page(opts, :author)
      _ -> {[], nil}
    end
  end

  def history(_, _), do: {[], nil}

  # Enumerate continuants, PK-seek each head. Ecto will not take a subquery
  # in ON, so the seek lives in WHERE; ON TRUE is not a scan — `k.id = ?`
  # is unique. Joining keeps on the selector column is the wound id:ka-vet 65
  # named (walks that journal on keeps_history_idx).
  defp fan(clan, :target) do
    from(w in "works",
      as: :work,
      join: r in "roots",
      on: r.root == w.root,
      join: k in "keeps",
      on: true,
      where: r.clan == ^clan and k.id == subquery(head_id(:target))
    )
  end

  defp fan(clan, :root) do
    from(r in "roots",
      as: :author,
      left_join: a in "authors",
      as: :named,
      on: a.author_id == r.author_id,
      join: k in "keeps",
      on: true,
      where: r.clan == ^clan and k.id == subquery(head_id(:root))
    )
  end

  defp head_id(:target) do
    from(k2 in "keeps",
      where: k2.target == parent_as(:work).work_id and k2.root == parent_as(:work).root,
      limit: 1,
      select: k2.id
    )
    |> by_author()
  end

  defp head_id(:root) do
    from(k2 in "keeps",
      where: k2.root == parent_as(:author).root,
      limit: 1,
      select: k2.id
    )
    |> by_author()
  end

  # Pre-cut fence through works (keep-cut IV). A root owns itself.
  defp depth(id, :target) do
    from(k in "keeps", where: k.target == ^id and k.root == subquery(owner_query(id)))
  end

  defp depth(id, :root) do
    from(k in "keeps", where: k.root == ^id)
  end

  # One wrapper, two clocks. The clock picks order, cursor, and whether the
  # stamp rides — so a fan row cannot grow (t, n) by accident (id:ka-law).
  defp page(q, opts, :author) do
    n = bound(opts)

    rows =
      q
      |> before_author(Keyword.get(opts, :after))
      |> by_author()
      |> limit(^n)
      |> river_row()
      |> stamp_row()
      |> Reader.all()

    {rows, next_of(rows, n, &cursor/1)}
  end

  defp page(q, opts, {:room, sel}) do
    n = bound(opts)

    rows =
      q
      |> before_room(Keyword.get(opts, :after))
      |> by_room()
      |> limit(^n)
      |> river_row()
      |> named_row(sel)
      |> Reader.all()

    {rows, next_of(rows, n, &room_cursor/1)}
  end

  defp next_of(rows, n, _codec) when length(rows) < n, do: nil
  defp next_of(rows, _n, codec), do: codec.(List.last(rows))

  # THE AUTHOR'S CLOCK, DECLARED ONCE. Sound wherever the domain is one hand
  # — one work, or one journal. Never used to order a room.
  defp by_author(q), do: order_by(q, [..., k], desc: k.ts_t, desc: k.ts_n)

  # THE ROOM'S CLOCK, DECLARED ONCE. `id` is the same-ms tiebreak (id:ka-cursor):
  # a cursor on `at` alone skips or duplicates when a backlog drains.
  defp by_room(q), do: order_by(q, [..., k], desc: k.shared_at, desc: k.id)

  # The hand a river belongs to — the fence id:ka-hijack exists for, asked once
  # by the bind and once by each target read. Scalar subquery, never a join,
  # so the target index survives (id:ka-vet 65).
  defp owner_query(work_id), do: from(w in "works", where: w.work_id == ^work_id, select: w.root)

  @doc """
  Pre-cut: journal of a river via the works table (keep-cut IV). Nil if never shared.
  """
  @spec owner_of(String.t()) :: String.t() | nil
  def owner_of(work_id) when is_binary(work_id), do: Reader.one(owner_query(work_id))
  def owner_of(_), do: nil

  # One row shape, two doors. The message rides whole so the reader derives
  # the name (id:kc-law 3); the picture is one immutable GET away (id:ka-seat).
  #
  # [⚑] NO STAMP HERE. Depth merges `(t, n)` on; the fan must not, because a
  # cursor cannot cross a hop (id:ka-law). The row shape is the fence.
  defp river_row(q) do
    select(q, [..., k], %{
      id: k.id,
      target: k.target,
      root: k.root,
      message: k.message,
      at: k.shared_at,
      node: k.shared_node,
      face: not is_nil(k.image)
    })
  end

  defp stamp_row(q), do: select_merge(q, [..., k], %{t: k.ts_t, n: k.ts_n})

  # The living name belongs to the journal fan only. History is one journal,
  # and relight already holds the departing hand (id:ks-name, id:ks-delta).
  defp named_row(q, :root), do: select_merge(q, [named: a], %{name: a.name})
  defp named_row(q, :target), do: q

  @doc """
  A depth row's stamp — `"<t>.<n>"` (id:ka-cursor). Twin of `after_cursor/1`.

  The order key itself, never re-derived from the message (id:kb-11-derive).
  A fan row has no stamp: `cursor/1` is nil there, which is the hop fence.
  """
  @spec cursor(map()) :: String.t() | nil
  def cursor(%{t: t, n: n}) when is_integer(t) and is_integer(n), do: "#{t}.#{n}"
  def cursor(_), do: nil

  @doc "Read an author-clock cursor back. Garbage is no cursor (id:ka-cursor)."
  @spec after_cursor(String.t() | nil) :: %{t: integer(), n: integer()} | nil
  def after_cursor(raw) when is_binary(raw) do
    with [t, n] <- String.split(raw, ".", parts: 2),
         {t, ""} <- Integer.parse(t),
         {n, ""} <- Integer.parse(n) do
      %{t: t, n: n}
    else
      _ -> nil
    end
  end

  def after_cursor(_), do: nil

  @doc """
  A fan row's place — `"<at>.<id>"`. Twin of `after_room/1`.

  The room's clock plus the name, already on the row. `id` is the same-ms
  tiebreak; a cursor on `at` alone is the residue id:ka-cursor named.
  """
  @spec room_cursor(map()) :: String.t() | nil
  def room_cursor(%{at: at, id: id}) when is_integer(at) and is_binary(id), do: "#{at}.#{id}"
  def room_cursor(_), do: nil

  @doc "Read a room-clock cursor back. Garbage is no cursor (id:ka-cursor)."
  @spec after_room(String.t() | nil) :: %{at: integer(), id: String.t()} | nil
  def after_room(raw) when is_binary(raw) do
    with [at, id] <- String.split(raw, ".", parts: 2),
         {at, ""} <- Integer.parse(at),
         true <- minted?(id) do
      %{at: at, id: id}
    else
      _ -> nil
    end
  end

  def after_room(_), do: nil

  defp before_author(q, %{t: t, n: n}) when is_integer(t) and is_integer(n) do
    where(q, [k], k.ts_t < ^t or (k.ts_t == ^t and k.ts_n < ^n))
  end

  defp before_author(q, _), do: q

  defp before_room(q, %{at: at, id: id}) when is_integer(at) and is_binary(id) do
    where(q, [..., k], k.shared_at < ^at or (k.shared_at == ^at and k.id < ^id))
  end

  defp before_room(q, _), do: q

  defp minted?(ref), do: ref =~ ~r/^[0-9a-f]{64}$/

  @doc """
  The picture beside a message, read back (id:kb-13, id:ka-seat).

  What makes client eviction lawful: a shared blob may be dropped because the
  room holds it, and this is what makes that true of reachability too.

  Absent is a named state, never an error (id:kc-e-missing-image).
  """
  @spec image_of(String.t()) :: {:ok, binary()} | :none
  def image_of(id) when is_binary(id) do
    if minted?(id) do
      case Reader.one(from(k in "keeps", where: k.id == ^id, select: k.image)) do
        bytes when is_binary(bytes) -> {:ok, bytes}
        _ -> :none
      end
    else
      :none
    end
  end

  def image_of(_), do: :none

  # ── pull (the read half of the fork word) ────────────────────────────

  @doc """
  One keep for a visitor (id:la-fork-pull). Ref is a keep id, else a work id
  answered with that work's HEAD by author order (id:kb-8). Source rides beside;
  absent is a tombstone. The reader verifies the name (id:kc-law 3).

  WAL is single-machine (id:kb-10). This door reads the local file only —
  `fly scale count 1`. Scale past one and half the traffic 404s with no error.
  """
  @spec pull(String.t()) :: {:ok, map()} | :none
  def pull(ref) when is_binary(ref) do
    if minted?(ref) do
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

  # Pre-cut HEAD via works (keep-cut III/IV). Not the contract — get is get.
  # [⚠] A scalar subquery, not a join — measured: a join drives from `works`
  # and discards `keeps_head_idx` (id:ka-vet 65).
  defp head_of(target) do
    Reader.one(
      from(k in "keeps",
        where: k.target == ^target and k.root == subquery(owner_query(target)),
        limit: 1,
        select: %{id: k.id, message: k.message, at: k.shared_at, node: k.shared_node}
      )
      |> by_author()
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

  # Twin of referent/1 — the picture rides the same ship. Absent is nil.
  defp picture(nil), do: {:ok, nil}

  defp picture(encoded) when is_binary(encoded) do
    with :ok <- within(encoded, @max_image),
         {:ok, bytes} <- decode64(encoded) do
      {:ok, bytes}
    end
  end

  defp picture(_), do: {:error, :shape}

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

  # Skeleton as data (id:kb-5-skeleton). Neither language owns it —
  # priv/keep is the keep's home; JS and this module are both guests.
  # Two hand-written predicates diverged once (id:kb-vet5 42); one table cannot.
  @skeleton_path Path.expand("../../priv/keep/skeleton.json", __DIR__)
  @external_resource @skeleton_path
  @skeleton @skeleton_path |> File.read!() |> Jason.decode!()

  defp decode(message) do
    case Jason.decode(message) do
      {:ok, %{} = e} -> {:ok, e}
      {:ok, _} -> {:error, :unparseable}
      {:error, _} -> {:error, :unparseable}
    end
  end

  # Catalog fields, right types. Meaning is never judged (id:kc-c-room).
  # The law is @skeleton; this is its interpreter — twin of entry.unshaped.
  # `means` on a row is for readers; the walk uses only field and type.
  defp shaped?(e) when is_map(e) do
    Enum.reduce_while(@skeleton, :ok, fn %{"field" => field, "type" => type}, :ok ->
      if type_ok?(fetch_path(e, field), type),
        do: {:cont, :ok},
        else: {:halt, {:error, :shape}}
    end)
  end

  # A missing key or a null is the same: not a value (id:kc-r-absence).
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

  # The table's type tags — vocabulary only; which fields wear which
  # lives solely in skeleton.json.
  defp type_ok?({:ok, v}, "string") when is_binary(v), do: true
  defp type_ok?({:ok, v}, "nonneg_int") when is_integer(v) and v >= 0, do: true
  defp type_ok?({:ok, v}, "int>=1") when is_integer(v) and v >= 1, do: true

  defp type_ok?(_, type)
       when type in ~w(string nonneg_int int>=1),
       do: false

  defp type_ok?(_, type), do: raise("unknown skeleton type: #{type}")

  defp name_matches?(id, claimed) when id == claimed, do: :ok
  defp name_matches?(_, _), do: {:error, :name}
end
