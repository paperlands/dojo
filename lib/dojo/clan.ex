defmodule Dojo.Clan do
  @derive Jason.Encoder
  defstruct name: nil

  @separator "-"

  def find(id) when is_binary(id) , do: %Dojo.Clan{name: id}
  def find(_) , do: nil

  def start(), do: %Dojo.Clan{name: gen_clan_name()}

  def gen_clan_name(count \\ 2) do
    get_name_frags(count) |> Enum.join(@separator)
  end

  def get_name_frags(num) when is_integer(num) do
    Dojo.Clan.Name.list |> Enum.take_random(num)
  end

end
