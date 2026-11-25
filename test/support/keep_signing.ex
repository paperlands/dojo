defmodule Dojo.KeepSigning do
  @moduledoc "Disposable deterministic signing hands; no production credentials."
  @order 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551

  def identity(seed) do
    scalar = rem(:binary.decode_unsigned(:crypto.hash(:sha256, seed)), @order - 1) + 1
    private = <<scalar::unsigned-big-256>>
    {public, ^private} = :crypto.generate_key(:ecdh, :secp256r1, private)

    genesis =
      Jason.encode!(%{
        "v" => 1,
        "kind" => "genesis",
        "ts" => %{"t" => 0, "n" => 0},
        "auth" => %{"v" => 1, "algorithm" => "P256-SHA256", "public_key" => hex(public)}
      })

    %{root: Dojo.Keep.hash(genesis), genesis: genesis, private: private}
  end

  def root(seed) do
    identity = identity(seed)
    :persistent_term.put({__MODULE__, identity.root}, identity)
    identity.root
  end

  def sign(%{"message" => message} = payload) do
    with {:ok, %{"root" => root}} <- Jason.decode(message),
         %{} = identity <- :persistent_term.get({__MODULE__, root}, nil) do
      Map.put(payload, "proof", proof(message, identity))
    else
      _ -> payload
    end
  end

  def proof(message, identity) do
    der =
      :crypto.sign(:ecdsa, :sha256, "dojo:keep-auth:v1\0" <> message, [
        identity.private,
        :secp256r1
      ])

    {:"ECDSA-Sig-Value", r, s} = :public_key.der_decode(:"ECDSA-Sig-Value", der)
    %{"v" => 1, "genesis" => identity.genesis, "signature" => hex(<<r::256, s::256>>)}
  end

  defp hex(bytes), do: Base.encode16(bytes, case: :lower)
end
