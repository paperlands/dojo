defmodule Dojo.Turtle do

  def hatch(img, %{class: pid}) when is_binary(img) do
    Dojo.Table.publish(pid, {__MODULE__, img}, :hatch)
  end

end
