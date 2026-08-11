defmodule Dojo.Keep do
  @moduledoc """
  Server half of the keep (id:kb-11 · id:kb-12).

  No Ecto schema. No changeset. An entry is already true when it is written.

  * `project/2` — derive every promoted column from the message; accept none
    (id:kb-11-derive). Pure.
  * `receive/2` — one ship: project → bind → stamp → insert → the **row's**
    fact (id:kb-12). The one place the clan decides anything is the bind;
    everything else is mechanical.
  * `image/2` — the referent that follows the fact (id:kb-12a).

  Five frozen fields only: v · kind · root · ts · target. Grep this module
  for entry fields and find those five, and no others, ever. `clan` is a
  fact of the wire, never of the entry.

  ## The referent law (id:kb-vet5-referent)

  A referent is what a keep POINTS AT; the message is what a keep IS. Both
  ride the same door, the same ceiling, the same fence — and the fence's
  subject is whatever the bind's subject is.

      source  hash(text)          fans on announce   never evicted   NO fence:
                                                                     it proves
                                                                     itself
      image   the message's id    rides the share    evictable       fenced by
                                                                     the bind

  Source needs no ownership fence because it is *verifiable*: `hash(text)`
  is its key, so wrong bytes land under a different name and harm nothing.
  The image is unverifiable by nature — its hash is deliberately not in the
  message — so first-write-wins must be fenced.
  """

  import Ecto.Query
  require Logger

  alias Dojo.Keep.Repo

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

  # A ceiling at the door, per species (id:kb-vet5-referent, finding 47).
  # Measured (id:kb-source): message 298 B, source ~850 B, image ~17 KB.
  # These are ~200× headroom — a fence against a runaway walk, not a budget.
  # The premise that held this open ("wants a measured number") has moved.
  @max_text 256 * 1024
  @max_image 4 * 1024 * 1024

  @type fact :: %{id: String.t(), at: integer(), node: String.t()}
  @type refusal :: %{id: String.t(), at: integer(), node: String.t(), why: reason()}
  @type reply :: %{shared: [fact()], refused: [refusal()]}

  # ── project (pure) ───────────────────────────────────────────────────

  @doc """
  Project a message into the columns the row holds.

  The wire carries `{id, message}`. The id is a *claim*; the name is derived
  from the bytes. Mismatch → `:name` (anti-divergence, not anti-forgery):
  a derived id the client never minted would make `share` no-op and re-ship
  forever.

  Returns `{:ok, cols}` or `{:error, :unparseable | :shape | :name}`.
  Pure — no repo, no side effect.
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
  One ship of one message (id:kb-12).

  Order is the law:

  1. **project** — can this message be a row? Mechanical.
  2. **bind** — first arrival of `root` owns it (TOFU). The only *decision*.
  3. **stamp** — `{at, node}` on every permanent answer, refusals included.
  4. **insert** — `ON CONFLICT DO NOTHING`.
  5. **reply** — the **row's** fact, read back; never the attempt's stamp.

  Permanent refusals (`:unparseable | :shape | :name | :root | :too_big`) are
  answers: stamped so the client can mark shared and announce terminates.
  Silence (empty reply, or no LiveView reply) is not an answer.

  The source rides beside the message and lands in the same transaction
  (id:kb-source-absence): it is the one referent that cannot be re-derived
  from anything, so a keep stored without it is a tombstone. Its key is
  **derived** — `hash(text)` — never read out of the message, which would be
  a sixth entry field.

  ## Options

    * `:clan` — fact of the wire (required)
    * `:author_id` — recorded on first arrival, never compared (id:kb-vet5-bind)
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
          %{} = fact -> %{shared: [fact], refused: []}
          # Insert vanished — pool blip, not an answer.
          nil -> silence()
        end

      :root ->
        note_refuse(cols.id, :root)
        %{shared: [], refused: [%{id: cols.id, at: at, node: node, why: :root}]}
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

  defp put_keep(cols, clan, at, node) do
    Repo.insert_all(
      "keeps",
      [
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
      ],
      on_conflict: :nothing,
      conflict_target: :id
    )
  end

  # The reply is the row's fact (id:kb-vet3 26) — ship twice is once for the
  # reply too, not only the disk.
  defp fact_of(id) do
    Repo.one(
      from(k in "keeps",
        where: k.id == ^id,
        select: %{id: k.id, at: k.shared_at, node: k.shared_node}
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

  defp by_id(id) do
    Repo.one(
      from(k in "keeps",
        where: k.id == ^id,
        select: %{id: k.id, message: k.message, at: k.shared_at, node: k.shared_node}
      )
    )
  end

  defp head_of(target) do
    Repo.one(
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
           Repo.one(from(s in "sources", where: s.id == ^sid, select: s.text)) do
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
    %{shared: [], refused: [%{id: id, at: at, node: node, why: why}]}
  end

  defp silence, do: %{shared: [], refused: []}

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

  defp decode(message) do
    case Jason.decode(message) do
      {:ok, %{} = e} -> {:ok, e}
      {:ok, _} -> {:error, :unparseable}
      {:error, _} -> {:error, :unparseable}
    end
  end

  # Five frozen fields, right types. Meaning is never judged (id:kc-c-room).
  # A ts that will never project is a permanent refusal — the server orders
  # by the column it derives (id:kb-11-derive). Caller has already decoded a map.
  defp shaped?(e) do
    with :ok <- field_string(e, "kind"),
         :ok <- field_string(e, "root"),
         :ok <- field_target(e),
         :ok <- field_ts(e),
         :ok <- field_v(e) do
      :ok
    else
      :error -> {:error, :shape}
    end
  end

  defp field_string(e, key) do
    case e do
      %{^key => v} when is_binary(v) -> :ok
      _ -> :error
    end
  end

  # target is always present; null is lawful (a keep about no work yet).
  defp field_target(%{"target" => t}) when is_binary(t) or is_nil(t), do: :ok
  defp field_target(_), do: :error

  defp field_ts(%{"ts" => %{"t" => t, "n" => n}})
       when is_integer(t) and is_integer(n) and t >= 0 and n >= 0 do
    :ok
  end

  defp field_ts(_), do: :error

  defp field_v(%{"v" => v}) when is_integer(v) and v >= 1, do: :ok
  defp field_v(_), do: :error

  defp name_matches?(id, claimed) when id == claimed, do: :ok
  defp name_matches?(_, _), do: {:error, :name}
end
