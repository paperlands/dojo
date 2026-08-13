defmodule DojoWeb.ColocatedCSS do
  @moduledoc """
  Global colocated CSS extract (lvdx-0). Styles travel with their HEEx owner
  and land in the fingerprinted asset graph — never in the LiveView document.

  No scoped CSS / `@scope` yet (lvdx tension: hold until boring in targets).
  """
  use Phoenix.LiveView.ColocatedCSS

  @impl true
  def transform("style", _attrs, css, _meta) do
    {:ok, css, []}
  end
end
