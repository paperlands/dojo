defmodule Dojo.Keep.Repo.Migrations.RewriteAuthors do
  @moduledoc """
  The one-time person rewrite (id:ki-compost-rewrite).

  `20260816000000` minted a NOT NULL label. A hash-parked root may carry no
  letters yet, so the label becomes nullable here. Each legacy author is
  re-keyed to `sha256("dojo-author/legacy-root/v1" <> 0 <> root)`, the old
  D007 mint is decoded back to its name when it still round-trips, and
  `roots.author_id` follows. The decoder lives here only; no runtime reader.
  """
  use Ecto.Migration

  @domain "dojo-author/legacy-root/v1"

  def up do
    execute("""
    CREATE TABLE authors_new (
      author_id TEXT PRIMARY KEY,
      name      TEXT,
      named_at  INTEGER NOT NULL
    ) STRICT
    """)

    execute(fn ->
      now = System.system_time(:millisecond)

      %{rows: rows} =
        repo().query!(
          """
          SELECT r.root, r.author_id, a.name, a.named_at
            FROM roots r
            LEFT JOIN authors a ON a.author_id = r.author_id
          """,
          []
        )

      Enum.each(rows, fn [root, old_id, name, named_at] ->
        new_id = key_of(root)

        repo().query!(
          """
          INSERT INTO authors_new (author_id, name, named_at)
          VALUES (?, ?, ?)
          ON CONFLICT(author_id) DO NOTHING
          """,
          [new_id, name || decode_name(old_id), named_at || now]
        )

        repo().query!("UPDATE roots SET author_id = ? WHERE root = ?", [new_id, root])
      end)
    end)

    execute("DROP TABLE authors")
    execute("ALTER TABLE authors_new RENAME TO authors")
  end

  # One-way: the D007 mint is retired, so the old ids cannot be reconstructed.
  def down do
    raise Ecto.MigrationError,
          "id:ki-compost-rewrite is a one-time rewrite; restore from a backup instead"
  end

  defp key_of(root) do
    :crypto.hash(:sha256, @domain <> <<0>> <> root)
    |> Base.encode16(case: :lower)
  end

  # The old mint was (name <> base64(time)) with every non-alphanumeric
  # character stripped. Find the split whose suffix still decodes to the
  # timestamp and round-trips; otherwise the root is hash-parked with no name.
  defp decode_name(nil), do: nil
  defp decode_name(old_id) when is_binary(old_id) and byte_size(old_id) > 1 do
    last = byte_size(old_id) - 1

    Enum.find_value(1..last, fn split ->
      suffix = binary_part(old_id, split, byte_size(old_id) - split)

      with {:ok, text} <- decode64(suffix),
           true <- Regex.match?(~r/^\d{4}-\d{2}-\d{2}T/, text),
           ^suffix <- strip(Base.encode64(text)) do
        binary_part(old_id, 0, split)
      else
        _ -> nil
      end
    end)
  end

  defp decode_name(_), do: nil

  defp decode64(suffix) do
    case rem(byte_size(suffix), 4) do
      1 -> :error
      rest -> Base.decode64(suffix <> String.duplicate("=", rem(4 - rest, 4)))
    end
  end

  defp strip(text), do: String.replace(text, ~r/[^a-zA-Z0-9]/, "")
end
