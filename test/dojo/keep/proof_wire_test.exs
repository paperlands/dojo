defmodule Dojo.Keep.ProofWireTest do
  use ExUnit.Case, async: false

  alias Dojo.Keep
  alias Dojo.Keep.Auth

  @corpus ~S"""
  import {proofCases} from './test/js/keep/proof_cases.mjs';
  import {checkKeepProof} from './assets/js/keep/auth.js';
  const rows = await proofCases();
  for (const row of rows) {
    try {await checkKeepProof(row.payload.message, row.payload.proof); row.cache_accepts = true;}
    catch {row.cache_accepts = false;}
  }
  console.log(JSON.stringify(rows));
  """

  test "browser cache and OTP agree on the same exact-byte proof corpus" do
    {output, status} = System.cmd("node", ["--input-type=module", "-e", @corpus])
    assert status == 0, output
    cases = Jason.decode!(String.trim(output))
    assert length(cases) == 35

    for %{"payload" => payload, "label" => label, "valid" => valid, "cache_accepts" => cache} <-
          cases do
      accepted =
        with {:ok, cols} <- Keep.project(payload["message"], payload["id"]),
             {:ok, _} <- Auth.verify(payload["message"], cols.root, payload["proof"]) do
          true
        else
          _ -> false
        end

      assert cache == valid, "cache verdict: #{label}"
      assert accepted == valid, "OTP verdict: #{label}"
    end
  end
end
