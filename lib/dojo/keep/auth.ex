defmodule Dojo.Keep.Auth do
  @moduledoc """
  Own-root write admission (id:keep-auth-write-guard).

  Genesis commits the public key; a detached P256-SHA256 proof signs the exact
  message under a fixed protocol domain. This grants no publication or reach.
  """

  @domain "dojo:keep-auth:v1\0"
  # Assertions are a different protocol: a signature over one must never be
  # replayable as a signature over the other (domain separation, D074).
  @assertion_domain "dojo:keep-assertion:v1\0"
  @max_genesis 64 * 1024

  @skeleton_path Path.expand("../../../priv/keep/skeleton.json", __DIR__)
  @external_resource @skeleton_path
  @clock_max @skeleton_path
             |> File.read!()
             |> Jason.decode!()
             |> Enum.find(&(&1["field"] == "ts.t"))
             |> Map.fetch!("max")

  @spec verify(String.t(), String.t(), term()) :: {:ok, map()} | {:error, :auth}
  def verify(message, root, %{"v" => 1, "genesis" => genesis, "signature" => signature} = proof)
      when is_binary(message) and byte_size(message) <= 256 * 1024 and is_binary(root) and
             is_binary(genesis) and byte_size(genesis) <= @max_genesis and
             is_binary(signature) and byte_size(signature) == 128 and map_size(proof) == 3 do
    with true <- hash(genesis) == root,
         {:ok, %{"root" => ^root}} <- unique_json(message),
         {:ok, birth} <- unique_json(genesis),
         {:ok, public_key} <- credential(birth),
         {:ok, raw_signature} <- hex(signature, 64),
         true <- valid_signature?(public_key, raw_signature, @domain <> message) do
      {:ok, %{root: root, epoch: 0, genesis: genesis, signature: signature}}
    else
      _ -> {:error, :auth}
    end
  end

  def verify(_, _, _), do: {:error, :auth}

  @doc """
  Verify a detached signature over canonical assertion bytes.

  The bytes being signed are the complete canonical envelope (identity, type,
  version, clock, key, value, dependency) — never the payload alone, never the
  digest alone. Returns a boolean because ingress has one decision.
  """
  @spec verify_assertion(binary(), binary(), binary()) :: boolean()
  def verify_assertion(public_key_hex, signature_hex, envelope_bytes)
      when is_binary(public_key_hex) and is_binary(signature_hex) and is_binary(envelope_bytes) do
    with {:ok, key} <- raw_public_key(public_key_hex),
         {:ok, raw_signature} <- hex(signature_hex, 64) do
      valid_signature?(key, raw_signature, @assertion_domain <> envelope_bytes)
    else
      _ -> false
    end
  end

  def verify_assertion(_, _, _), do: false

  @doc """
  Sign canonical assertion bytes (local writers and tests).

  The private key never enters the log: a caller signs, the log verifies.
  """
  @spec sign_assertion(binary(), binary()) :: binary()
  def sign_assertion(private_key, envelope_bytes)
      when is_binary(private_key) and is_binary(envelope_bytes) do
    der =
      :crypto.sign(:ecdsa, :sha256, @assertion_domain <> envelope_bytes, [
        private_key,
        :secp256r1
      ])

    {:"ECDSA-Sig-Value", r, s} = :public_key.der_decode(:"ECDSA-Sig-Value", der)
    Base.encode16(<<r::unsigned-big-256, s::unsigned-big-256>>, case: :lower)
  end

  defp raw_public_key(hex_key) do
    case hex(hex_key, 65) do
      {:ok, <<4, _::binary-size(64)>> = key} -> {:ok, key}
      _ -> :error
    end
  end

  defp credential(%{
         "v" => 1,
         "kind" => "genesis",
         "ts" => %{"t" => t, "n" => n},
         "auth" => %{"v" => 1, "algorithm" => "P256-SHA256", "public_key" => public_key} = auth
       })
       when is_integer(t) and t >= 0 and t <= @clock_max and
              is_integer(n) and n >= 0 and n <= @clock_max and map_size(auth) == 3 do
    case hex(public_key, 65) do
      {:ok, <<4, _::binary-size(64)>> = key} -> {:ok, key}
      _ -> {:error, :auth}
    end
  end

  defp credential(_), do: {:error, :auth}

  defp valid_signature?(key, <<r::unsigned-big-256, s::unsigned-big-256>>, bytes) do
    signature = :public_key.der_encode(:"ECDSA-Sig-Value", {:"ECDSA-Sig-Value", r, s})
    :crypto.verify(:ecdsa, :sha256, bytes, signature, [key, :secp256r1])
  rescue
    _ -> false
  catch
    _, _ -> false
  end

  defp hex(value, size) when is_binary(value) and byte_size(value) == size * 2 do
    if value =~ ~r/\A[0-9a-f]+\z/, do: Base.decode16(value, case: :lower), else: :error
  end

  defp hex(_, _), do: :error

  defp hash(bytes), do: :crypto.hash(:sha256, bytes) |> Base.encode16(case: :lower)

  defp unique_json(bytes) do
    with {:ok, term} <- Jason.decode(bytes, objects: :ordered_objects),
         {:ok, value} <- plain(term) do
      {:ok, value}
    else
      _ -> {:error, :auth}
    end
  end

  defp plain(%Jason.OrderedObject{values: pairs}) do
    keys = Enum.map(pairs, &elem(&1, 0))

    with true <- length(Enum.uniq(keys)) == length(keys),
         {:ok, values} <- plain(Enum.map(pairs, &elem(&1, 1))) do
      {:ok, Map.new(Enum.zip(keys, values))}
    else
      _ -> {:error, :auth}
    end
  end

  defp plain(list) when is_list(list) do
    Enum.reduce_while(list, {:ok, []}, fn term, {:ok, acc} ->
      case plain(term) do
        {:ok, value} -> {:cont, {:ok, [value | acc]}}
        error -> {:halt, error}
      end
    end)
    |> case do
      {:ok, values} -> {:ok, Enum.reverse(values)}
      error -> error
    end
  end

  defp plain(value), do: {:ok, value}
end
