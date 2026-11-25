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

  @type reason :: :unparseable | :shape | :name | :too_big | :auth

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
  Signed own-root ship. Authentication precedes every database write; receipts
  and frozen legacy bindings confer no signing rights (id:keep-auth-write-guard).
  """
  @spec receive(map(), keyword()) :: reply()
  def receive(%{"id" => id, "message" => message} = payload, opts)
      when is_binary(id) and is_binary(message) do
    clan = Keyword.fetch!(opts, :clan)
    author_id = Keyword.fetch!(opts, :author_id)

    with :ok <- within(message, @max_text),
         {:ok, source} <- referent(payload["source"]),
         {:ok, image} <- picture(payload["image"]),
         {:ok, cols} <- project(message, id),
         {:ok, evidence} <- Dojo.Keep.Auth.verify(message, cols.root, payload["proof"]) do
      admit(cols, source, image, evidence, clan, author_id)
    else
      {:error, why} -> refuse(id, why)
    end
  end

  def receive(%{"id" => id}, _opts) when is_binary(id), do: refuse(id, :shape)
  def receive(_, _), do: silence()

  # ── private: receive path ────────────────────────────────────────────

  # Pre-cut binds (keep-cut IV). Frozen.
  defp admit(cols, source, image, evidence, clan, author_id) do
    %{at: at, node: node} = stamp()

    # One transaction holds the bindings and the log (id:kb-source-keys) — a
    # `roots` row or destination receipt outliving a failed keep would be
    # authority the log never gave.
    outcome =
      Repo.transact(fn ->
        with :ok <- note_root(cols.root, clan, author_id, at),
             :ok <- note_receipt(clan, cols.id, at, node) do
          put_source(source)
          put_keep(cols, clan, at, node, image)
          put_evidence(cols.id, evidence)
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

  # Bookkeeping, not a fence (keep-cut IV). The row records where a root was
  # first seen; nothing reads it for permission, so a first arrival cannot
  # preempt a later authenticated hand. author_id is history, never compared.
  defp note_root(root, clan, author_id, at) do
    Repo.insert_all(
      "roots",
      [%{root: root, clan: clan, author_id: author_id, bound_at: at}],
      on_conflict: :nothing,
      conflict_target: :root
    )

    :ok
  end

  # Independent destination evidence: first receipt per (room, keep).
  defp note_receipt(clan, id, at, node) do
    Repo.insert_all(
      "clan_keeps",
      [%{clan: clan, id: id, at: at, node: node}],
      on_conflict: :nothing,
      conflict_target: [:clan, :id]
    )

    :ok
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

  defp put_evidence(id, evidence) do
    Repo.insert_all("keep_evidence", [Map.take(evidence, [:root, :epoch, :genesis])],
      on_conflict: :nothing
    )

    Repo.insert_all("keep_proofs", [evidence |> Map.drop([:genesis]) |> Map.put(:id, id)],
      on_conflict: :nothing
    )
  end

  defp put_keep(cols, clan, at, node, image) do
    Repo.insert_all("keeps", [row(cols, clan, at, node, image)],
      on_conflict: :nothing,
      conflict_target: :id
    )
  end

  defp dump_image(nil), do: nil
  defp dump_image(bytes) when is_binary(bytes), do: {:blob, bytes}

  # The reply is the row's share-fact. The stored image digest lets a client
  # compare the bytes it holds with the bytes this node kept; an ack alone does
  # not identify a referent. Read pool after commit. (id:keep-foundation-retention)
  defp fact_of(id) do
    case Reader.one(
           from(k in "keeps",
             where: k.id == ^id,
             select: %{
               id: k.id,
               at: k.shared_at,
               node: k.shared_node,
               target: k.target,
               image: k.image
             }
           )
         ) do
      %{image: image} = fact ->
        fact
        |> Map.delete(:image)
        |> Map.put(:image_digest, if(is_binary(image), do: hash(image)))

      _ ->
        nil
    end
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
      sel when sel in [:root, :target] -> room_page(clan, sel, opts)
    end
  end

  def latest(_, _), do: {[], nil}

  @doc """
  Pre-cut depth page (keep-cut III). Open-work is a fold, not this door.
  """
  @spec history(String.t(), keyword()) :: {[map()], String.t() | nil}
  def history(id, opts \\ [])

  def history(id, opts) when is_binary(id) do
    case {minted?(id), of(opts)} do
      {true, :target} -> id |> target_depth() |> page(opts, :author)
      {true, :root} -> id |> depth(:root) |> page(opts, :author)
      _ -> {[], nil}
    end
  end

  def history(_, _), do: {[], nil}

  # A room page ranks delivered metadata in SQL, then fetches message bytes for
  # at most `n` rows. Nothing materialises a room into the BEAM.
  defp room_page(clan, sel, opts) do
    n = bound(opts)
    cursor = Keyword.get(opts, :after)

    rows =
      case sel do
        :root -> page_roots(clan, opts[:except], cursor, n)
        :target -> page_works(clan, cursor, n)
      end
      |> Reader.all()
      |> Enum.map(&Map.put(&1, :proof, public_proof(&1)))

    {rows, next_of(rows, n, &room_cursor/1)}
  end

  # Eligibility is origin membership on the delivered keep; the head is the
  # newest author tuple per work in this room. Legacy only when no keep claims
  # the id and a frozen works key exists.
  defp page_works(clan, cursor, n) do
    origin =
      origin_root(dynamic([], coalesce(parent_as(:member).target, parent_as(:member).id)))

    known_work =
      from(o in "keeps",
        where: o.id == coalesce(parent_as(:member).target, parent_as(:member).id),
        select: 1
      )

    legacy_owner =
      from(w in "works", where: w.work_id == parent_as(:member).target, select: w.root)

    heads =
      from(k in "keeps",
        as: :member,
        join: ck in "clan_keeps",
        on: ck.id == k.id,
        where: ck.clan == ^clan,
        where:
          (exists(subquery(member_proof())) and k.root == subquery(origin)) or
            (not exists(subquery(known_work)) and not is_nil(k.target) and
               k.root == subquery(legacy_owner)),
        windows: [
          by_work: [
            partition_by: fragment("coalesce(?, ?)", k.target, k.id),
            order_by: [desc: k.ts_t, desc: k.ts_n, desc: k.id]
          ]
        ],
        select: %{
          id: k.id,
          target: k.target,
          root: k.root,
          work: fragment("coalesce(?, ?)", k.target, k.id),
          at: ck.at,
          node: ck.node,
          rn: over(row_number(), :by_work)
        }
      )

    heads
    |> subquery()
    |> where([h], h.rn == 1)
    |> room_cursor_filter(cursor)
    |> order_by([h], desc: h.at, desc: h.id)
    |> limit(^n)
    |> subquery()
    |> keep_rows(:target)
    |> with_proof()
  end

  # The room's census is its delivered set, not the first room that saw the
  # root. `roots` rides along for letters and self-skip only.
  defp page_roots(clan, except, cursor, n) do
    heads =
      from(k in "keeps",
        join: ck in "clan_keeps",
        on: ck.id == k.id,
        left_join: r in "roots",
        on: r.root == k.root,
        where: ck.clan == ^clan,
        windows: [
          by_root: [
            partition_by: k.root,
            order_by: [desc: k.ts_t, desc: k.ts_n, desc: k.id]
          ]
        ],
        select: %{
          id: k.id,
          root: k.root,
          at: ck.at,
          node: ck.node,
          rn: over(row_number(), :by_root)
        }
      )

    heads =
      if is_binary(except) do
        where(heads, [k, ck, r], is_nil(r.author_id) or r.author_id != ^except)
      else
        heads
      end

    heads
    |> subquery()
    |> where([h], h.rn == 1)
    |> room_cursor_filter(cursor)
    |> order_by([h], desc: h.at, desc: h.id)
    |> limit(^n)
    |> subquery()
    |> keep_rows(:root)
    |> with_proof()
  end

  # Message bytes for the selected rows only. History and head stay global.
  defp keep_rows(q, :target) do
    from(h in subquery(q),
      join: k in "keeps",
      on: k.id == h.id,
      order_by: [desc: h.at, desc: h.id],
      select: %{
        id: h.id,
        target: h.target,
        root: h.root,
        message: k.message,
        face: not is_nil(k.image),
        at: h.at,
        node: h.node
      }
    )
  end

  defp keep_rows(q, :root) do
    from(h in subquery(q),
      join: k in "keeps",
      on: k.id == h.id,
      left_join: r in "roots",
      on: r.root == h.root,
      left_join: a in "authors",
      on: a.author_id == r.author_id,
      order_by: [desc: h.at, desc: h.id],
      select: %{
        id: h.id,
        root: h.root,
        message: k.message,
        name: a.name,
        face: not is_nil(k.image),
        at: h.at,
        node: h.node
      }
    )
  end

  defp room_cursor_filter(q, %{at: at, id: id}) when is_integer(at) and is_binary(id) do
    where(q, [h], h.at < ^at or (h.at == ^at and h.id < ^id))
  end

  defp room_cursor_filter(q, _), do: q

  # Pre-cut fence through works (keep-cut IV). A root owns itself.
  # An id that is a keep is never re-read as a legacy work: origin, or known
  # child (no members), never works. Legacy survives only for ids nothing
  # claims — and only while a frozen works key exists.
  defp target_depth(id) do
    cond do
      Reader.one(origin_root(id)) != nil -> modern_depth(id)
      any_keep?(id) -> from(k in "keeps", where: false)
      true -> legacy_depth(id)
    end
  end

  # An origin never authenticates an unsigned child (id:keep-auth-write-guard).
  defp member_proof do
    from(p in "keep_proofs",
      join: e in "keep_evidence",
      on: e.root == p.root and e.epoch == p.epoch,
      where: p.id == parent_as(:member).id and p.root == parent_as(:member).root,
      select: 1
    )
  end

  defp modern_depth(id) do
    from(k in "keeps",
      as: :member,
      where:
        (k.id == ^id or k.target == ^id) and k.root == subquery(origin_root(id)) and
          exists(subquery(member_proof()))
    )
  end

  defp legacy_depth(id) do
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
      |> with_proof()
      |> Reader.all()
      |> Enum.map(&Map.put(&1, :proof, public_proof(&1)))

    {rows, next_of(rows, n, &cursor/1)}
  end

  defp next_of(rows, n, _codec) when length(rows) < n, do: nil
  defp next_of(rows, _n, codec), do: codec.(List.last(rows))

  # THE AUTHOR'S CLOCK, DECLARED ONCE. Sound wherever the domain is one hand
  # — one work, or one journal. Never used to order a room.
  defp by_author(q), do: order_by(q, [..., k], desc: k.ts_t, desc: k.ts_n, desc: k.id)

  # The hand a river belongs to — the fence id:ka-hijack exists for, asked by
  # each legacy read. Scalar subquery, never a join, so the target index
  # survives (id:ka-vet 65).
  defp owner_query(work_id), do: from(w in "works", where: w.work_id == ^work_id, select: w.root)

  # One origin proof for scalar reads and the room query (id:keep-auth-origin-seam).
  # Only admitted exact-byte proof and its root/key evidence establish an origin.
  defp origin_root(work_id) do
    proof = dynamic([o], o.id == ^work_id and is_nil(o.target))

    from(o in "keeps",
      join: p in "keep_proofs",
      on: p.id == o.id and p.root == o.root,
      join: e in "keep_evidence",
      on: e.root == p.root and e.epoch == p.epoch,
      where: ^proof,
      distinct: true,
      select: o.root
    )
  end

  defp any_keep?(id) do
    Reader.one(from(k in "keeps", where: k.id == ^id, select: count(k.id))) > 0
  end

  @doc """
  The origin's root for an evidenced work; otherwise legacy display only.

  A keep at `work_id` that is not a targetless origin is a child: it resolves
  to nil, never to a works row. The legacy fallback is for old rivers whose id
  is not a keep at all, and it grants no membership or effect.
  """
  @spec owner_of(String.t()) :: String.t() | nil
  def owner_of(work_id) when is_binary(work_id) do
    cond do
      not minted?(work_id) -> nil
      root = Reader.one(origin_root(work_id)) -> root
      any_keep?(work_id) -> nil
      true -> Reader.one(owner_query(work_id))
    end
  end

  def owner_of(_), do: nil

  @doc """
  The letters a keep signs for one hand — `signature_of[root]` — or nil.

  Display reads letters from the bytes, never the retired `authors` table
  (id:kc-sign). A hand that signed none has none: absence is a state.
  """
  @spec letters(String.t(), String.t()) :: String.t() | nil
  def letters(message, root) when is_binary(message) and is_binary(root) do
    with {:ok, e} <- decode(message),
         %{} = sig <- Map.get(e, "signature_of"),
         signed when is_binary(signed) and signed != "" <- Map.get(sig, root) do
      signed
    else
      _ -> nil
    end
  end

  def letters(_, _), do: nil

  @doc "The journal a keep belongs to — read from its bytes, never guessed."
  @spec root_of(String.t()) :: String.t() | nil
  def root_of(message) when is_binary(message) do
    case decode(message) do
      {:ok, %{"root" => root}} when is_binary(root) -> root
      _ -> nil
    end
  end

  def root_of(_), do: nil

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
  A depth row's place — `"<t>.<n>.<id>"` (id:ka-cursor). Twin of `after_cursor/1`.

  The order key itself, never re-derived from the message (id:kb-11-derive).
  `id` is the tie-break for equal `(t, n)`: without it a page boundary silently
  drops rows. A fan row has no stamp, so `cursor/1` is nil there — the hop fence.
  """
  @spec cursor(map()) :: String.t() | nil
  def cursor(%{t: t, n: n, id: id})
      when is_integer(t) and is_integer(n) and is_binary(id),
      do: "#{t}.#{n}.#{id}"

  def cursor(_), do: nil

  @doc """
  Read an author-clock cursor back. Only a full `"<t>.<n>.<id>"` decodes.

  The old two-part cursor cannot name the row it stopped at, so it is no cursor:
  the page restarts from the head and the caller sees a fresh full cursor, rather
  than being told there are no gaps (id:ka-cursor).
  """
  @spec after_cursor(String.t() | nil) :: %{t: integer(), n: integer(), id: String.t()} | nil
  def after_cursor(raw) when is_binary(raw) do
    with [t, n, id] <- String.split(raw, ".", parts: 3),
         {t, ""} <- Integer.parse(t),
         {n, ""} <- Integer.parse(n),
         true <- minted?(id) do
      %{t: t, n: n, id: id}
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

  # One tuple, three terms: (t, n, id). A two-term seek is the skip.
  defp before_author(q, %{t: t, n: n, id: id})
       when is_integer(t) and is_integer(n) and is_binary(id) do
    where(
      q,
      [k],
      k.ts_t < ^t or
        (k.ts_t == ^t and (k.ts_n < ^n or (k.ts_n == ^n and k.id < ^id)))
    )
  end

  defp before_author(q, _), do: q

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
  That exact keep, or nothing. No head fallback (keep-cut III).

  This is the contract door; `pull/1` is the deprecated resolver beside it and
  `head/1` is the evidenced work read.
  """
  @spec get(String.t()) :: {:ok, map()} | :none
  def get(ref) when is_binary(ref) do
    if minted?(ref) do
      case by_id(ref) do
        nil -> :none
        row -> {:ok, hydrate(row)}
      end
    else
      :none
    end
  end

  def get(_), do: :none

  @doc """
  Newest evidenced member of W, origin included, or `:none`.

  W must have an admitted signed origin, and each member its own proof.
  This read selects retained state, not publication or room reach. There is no
  legacy fallback; `pull/1` keeps that for old URLs.
  """
  @spec head(String.t()) :: {:ok, map()} | :none
  def head(work_id) when is_binary(work_id) do
    if minted?(work_id) do
      case global_member_row(work_id) do
        nil -> :none
        row -> {:ok, hydrate(row)}
      end
    else
      :none
    end
  end

  def head(_), do: :none

  @doc """
  Deprecated resolver, for old URLs only (id:la-fork-pull).

  Exact keep first; else the works-table head of an origin-less legacy river.
  The legacy fallback never runs for an id that is a keep, never crosses into
  evidenced work membership, and grants no authority.
  """
  @spec pull(String.t()) :: {:ok, map()} | :none
  def pull(ref) when is_binary(ref) do
    case get(ref) do
      {:ok, keep} -> {:ok, keep}
      :none -> legacy_pull(ref)
    end
  end

  def pull(_), do: :none

  defp legacy_pull(ref) do
    if minted?(ref) and not any_keep?(ref) do
      case legacy_head(ref) do
        nil -> :none
        row -> {:ok, hydrate(row)}
      end
    else
      :none
    end
  end

  # Pull half lives on the read pool (id:kb-10) — WAL readers, not the writer.
  defp by_id(id) do
    Reader.one(
      from(k in "keeps",
        where: k.id == ^id,
        select: %{id: k.id, message: k.message, at: k.shared_at, node: k.shared_node}
      )
      |> with_proof()
    )
  end

  defp global_member_row(work_id) do
    Reader.one(
      from(k in modern_depth(work_id),
        order_by: [desc: k.ts_t, desc: k.ts_n, desc: k.id],
        limit: 1,
        select: %{id: k.id, message: k.message, at: k.shared_at, node: k.shared_node}
      )
      |> with_proof()
    )
  end

  defp with_proof(query) do
    from(k in query,
      left_join: p in "keep_proofs",
      on: p.id == k.id and p.root == k.root and p.epoch == 0,
      left_join: e in "keep_evidence",
      on: e.root == p.root and e.epoch == p.epoch,
      select_merge: %{proof: %{v: 1, genesis: e.genesis, signature: p.signature}}
    )
  end

  defp public_proof(%{proof: %{genesis: genesis, signature: signature} = proof})
       when is_binary(genesis) and is_binary(signature),
       do: proof

  defp public_proof(_), do: nil

  defp hydrate(row) do
    %{
      id: row.id,
      message: row.message,
      source: source_of(row.message),
      proof: public_proof(row),
      at: row.at,
      node: row.node
    }
  end

  # Legacy HEAD via works (keep-cut III/IV). Not the contract — get is get.
  # [⚠] A scalar subquery, not a join — measured: a join drives from `works`
  # and discards `keeps_head_idx` (id:ka-vet 65).
  defp legacy_head(target) do
    Reader.one(
      from(k in "keeps",
        where: k.target == ^target and k.root == subquery(owner_query(target)),
        limit: 1,
        select: %{id: k.id, message: k.message, at: k.shared_at, node: k.shared_node}
      )
      |> by_author()
      |> with_proof()
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
  # Bounds live beside types in the catalog (id:keep-auth-durable-proof).
  defp shaped?(e) when is_map(e) do
    Enum.reduce_while(@skeleton, :ok, fn %{"field" => field, "type" => type} = rule, :ok ->
      value = fetch_path(e, field)

      if type_ok?(value, type) and within_max?(value, rule["max"]),
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

  # Catalog vocabulary and bounds, interpreted without new field policy.
  defp within_max?(_, nil), do: true
  defp within_max?({:ok, value}, max), do: value <= max

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
