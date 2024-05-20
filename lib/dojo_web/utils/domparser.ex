defmodule DojoWeb.Utils.DOMParser do
  def extract_page_from_markdown(md) when is_binary(md) do
    extract_link_from_markdown(md)
    # |> LinkPreview.create()
  end

  def extract_link_from_markdown(md) when is_binary(md) do
    {:ok, ast, _} = Earmark.as_ast(md)
    String.trim(extract_link_from_ast(ast, ""))
  end

  defp extract_link_from_ast(ast, result) when is_list(ast) and is_binary(result) do
    Enum.reduce_while(ast, result, fn
      {"a", atts, children, _m}, acc ->
        case Enum.into(atts, %{}) do
          %{"href" => link} -> {:halt, link}
          _ -> {:cont, extract_link_from_ast(children, acc)}
        end

      {_html_tag, _atts, children, _m}, acc ->
        {:cont, extract_link_from_ast(children, acc)}

      _, acc ->
        {:cont, acc}
    end)
  end

  def extract_html_from_md(md) when is_binary(md) do
    case Earmark.as_html(md) do
      {:ok, result, _} -> result |> HtmlSanitizeEx.html5() |> Phoenix.HTML.raw()
      _ -> ""
    end
  end

  def extract_html_from_md(_), do: ""
end
