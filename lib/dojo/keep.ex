defmodule Dojo.Keep do
  @moduledoc """
  Server half of the keep (id:kb-11 · id:kb-12). No Ecto schema/changeset.

  * `project/2` — derive columns; accept none (id:kb-11-derive)
  * `receive/2` — project → bind → stamp → insert → row fact (id:kb-12)
  * `image/2` — referent after the fact (id:kb-12a)

  Frozen entry fields: v · kind · root · ts · target. `clan` is wire fact.

  Referents (id:kb-vet5-referent): source is hash(text) — verifiable, no fence;
  image is the message id — fenced by the bind, first-write-wins.

  ## Reads are open; writes are bound

  Privacy is residence, not permission: a keep lives in the browser until
  `announce` ships it, so everything the room holds is already published. There
  is no third state, and therefore nothing for a read fence to guard.

  What is defended is authorship. Two binds, one per continuant, each decided by
  its primary key (id:ka-rule): a root belongs to one room (D017), a river to
  one hand (id:ka-works-bind). `clan` scopes writes — it is a query parameter on
  the way out, never a fence.
  """

  import Ecto.Query
  require Logger

  alias Dojo.Keep.Repo
  alias Dojo.Keep.Repo.Reader

  @type cols :: %{
          id: String.t(),
          root: String.t(),
          kind: String.t(),
          target: String.t(),
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
  One ship (id:kb-12): project → bind (TOFU) → stamp → insert → row fact.
  Permanent refusals are answers (stamped + why). Silence is nil.
  Source lands in the same transaction; key is `hash(text)`, never the message.
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

  # One judgement per continuant, by its primary key (id:ka-rule).
  # :root — this root is another room's; :work — this river is another hand's.
  defp admit(cols, source, clan, author_id) do
    %{at: at, node: node} = stamp()

    # One transaction holds all four stores (id:kb-source-keys) — a `works` or
    # `roots` row outliving a failed keep would be authority the log never gave.
    outcome =
      Repo.transact(fn ->
        with :ok <- bind(cols.root, clan, author_id, at),
             :ok <- bind_work(cols) do
          put_source(source)
          put_keep(cols, clan, at, node)
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

  # TOFU: a root belongs to one room. The primary key is the ACL (D017).
  # author_id is recorded, never compared (id:kb-vet5-bind) — the name is not a continuant.
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

  # What each kind's `target` NAMES (id:ka-selectors). `target` carries more
  # than one continuant — a work has one owner, a node has none — so the day a
  # kind is born this table must answer "does its target have an owner?".
  # A kind absent here binds nothing: enforcement fails open (id:kb-12), and
  # the reads that need a binding then find none until the projection is
  # rebuilt (id:kb-vet2-rebuild).
  @owned_kinds %{"snap" => :work}

  @doc "What each kind's `target` names (id:ka-selectors). Bijective with kinds/."
  @spec owned_kinds() :: %{String.t() => :work | :node}
  def owned_kinds, do: @owned_kinds

  # TOFU for the second continuant: a river belongs to one hand
  # (id:ka-works-bind). id:ka-hijack measured the cost of its absence — a
  # clan-mate's keep became the river's HEAD for every `?fork=` visitor.
  # A signature says who wrote these bytes; this says what is yours.
  defp bind_work(%{target: target, kind: kind, root: root}) do
    if is_binary(target) and @owned_kinds[kind] == :work do
      Repo.insert_all("works", [%{work_id: target, root: root}],
        on_conflict: :nothing,
        conflict_target: :work_id
      )

      case Repo.one(owner_of(target)) do
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
  Fill a shared keep's picture, once (id:kb-12a). No reply: it lands or it
  doesn't; a lost picture re-runs the turtle (id:kc-e-missing-image).
  `image IS NULL` makes the first write final; `clan` is the fence (id:kb-vet5-bind).
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

  # ── two doors, one lattice (id:ka-surface) ───────────────────────────
  #
  # selector × depth. latest is the fan (handles); history is one handle
  # opened. `of:` is the selector — the only per-selector clause is which
  # continuant, and for a target the ownership fence. A root owns itself.
  #
  # Two clocks, two codecs. Author orders within a hand; room orders the
  # hands. A cursor cannot cross a hop, so a fan row never carries (t, n).

  @selectors [:target, :root]
  @page 12
  @page_max 200

  @doc "The declared continuant selectors (id:ka-selectors). A query names one."
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
  The fan — each continuant's head, arranged by the room's clock (id:ka-latest).

  `of: :target` (default) is last keep of each river; `of: :root` is last keep
  of each journal. Last *word*, not last packet: the head is the author's
  clock, the arrangement is the room's.

  Cursored by `at.id`. A cap without a cursor is a wall; 200 is a page.
  The pair is returned because only this function knows the bound.

  `clan` names which room to show, and scopes through `roots` because the bind
  is the reason and `keeps.clan` is the copy (id:kb-11-derive).
  """
  @spec latest(String.t(), keyword()) :: {[map()], String.t() | nil}
  def latest(clan, opts \\ [])

  def latest(clan, opts) when is_binary(clan) do
    case of(opts) do
      nil -> {[], nil}
      sel -> clan |> fan(sel) |> page(opts, :room)
    end
  end

  def latest(_, _), do: {[], nil}

  @doc """
  One continuant, newest first — the page and the next cursor
  (id:ka-door-shape, id:ka-cursor).

  `of: :target` (default) is one river: a work id, never a keep id
  (id:ka-capability). `of: :root` is one journal: a root owns itself.

  Shows, never accepts — no `source` rides (id:kb-13-ground).
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

  # A target is fenced by its owner (id:ka-works-bind); a root owns itself.
  defp depth(id, :target) do
    from(k in "keeps", where: k.target == ^id and k.root == subquery(owner_of(id)))
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

  defp page(q, opts, :room) do
    n = bound(opts)

    rows =
      q
      |> before_room(Keyword.get(opts, :after))
      |> by_room()
      |> limit(^n)
      |> river_row()
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
  defp owner_of(work_id), do: from(w in "works", where: w.work_id == ^work_id, select: w.root)

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

  # Newest keep of one hand's river (id:ka-works-bind). Ordering by ts is sound
  # only over a single hand, and the bind is what makes that a server fact.
  # An unbound target answers nothing rather than guessing.
  #
  # [⚠] A scalar subquery, not a join — measured: a join drives from `works`
  # and discards `keeps_head_idx` (id:ka-vet 65).
  defp head_of(target) do
    Reader.one(
      from(k in "keeps",
        where: k.target == ^target and k.root == subquery(owner_of(target)),
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
