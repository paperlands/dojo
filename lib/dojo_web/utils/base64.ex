defmodule DojoWeb.Utils.Base64 do
  @doc """
  Converts a base64 data URI to a file using binary matching.

  ## Parameters
    - data_uri: Full data URI string (e.g., "data:image/png;base64,...")
    - filename: Output filename (optional)

  ## Returns
    - filename of the created file
    - Raises an error if conversion fails

  ## Examples
      iex> to_file("data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7")
      "image.gif"

      iex> to_file("data:image/png;base64,iVBORw0...", "custom.png")
      "custom.png"
  """
  def to_file(data_uri, filename) when is_binary(data_uri) do
    with {:ok, mime_type, base64_content} <- extract_data(data_uri),
         ext <- get_extension(mime_type),
         :ok <- write_file(filename <> ext, base64_content) do
      filename <> ext
    else
      {:error, reason} -> {:error, reason}
    end
  end

  def to_file(_, _), do: nil

  defp extract_data(data_uri) do
    case :binary.match(data_uri, ";base64,") do
      :nomatch ->
        {:error, "Invalid data URI format"}

      {start, length} ->
        mime_type = binary_part(data_uri, 5, start - 5)

        base64_content =
          binary_part(data_uri, start + length, byte_size(data_uri) - start - length)

        case Base.decode64(base64_content) do
          {:ok, decoded} -> {:ok, mime_type, decoded}
          :error -> {:error, "Failed to decode base64 content"}
        end
    end
  end

  defp get_extension(mime_type) do
    case mime_type do
      "image/jpeg" -> ".jpg"
      "image/png" -> ".png"
      "image/gif" -> ".gif"
      "image/webp" -> ".webp"
      "image/bmp" -> ".bmp"
      "image/svg+xml" -> ".svg"
      _ -> ""
    end
  end

  defp write_file(filename, content) do
    case File.open(filename, [:write]) do
      {:ok, file} ->
        IO.binwrite(file, content)
        File.close(file)
        :ok

      {:error, reason} ->
        {:error, "Failed to write file #{filename}: #{reason}"}
    end
  end
end
