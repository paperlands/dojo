defmodule Dojo.Keep.LinkRoundtripTest do
  @moduledoc """
  Routed Phoenix responses meet the actual JS reader and memory-IDB journal.
  No live server, browser, renderer or real user profile is exercised.
  """
  # External Node lifetimes must not hold the sole writer while async cases queue.
  use Dojo.DataCase

  import Phoenix.ConnTest
  import Plug.Conn

  alias Dojo.Keep

  @endpoint DojoWeb.Endpoint

  @mint ~S"""
  import { createEngine } from './assets/js/keep/journal.store.js';
  import { createJournal } from './assets/js/keep/journal.js';
  import { createMemoryIDB } from './test/js/keep/idb_memory.mjs';
  import { name } from './assets/js/keep/entry.js';
  import { writeSnap } from './assets/js/keep/kinds/snap.js';
  const open = () => { const {idb, KeyRange} = createMemoryIDB(); return createJournal({engine: createEngine({idb, KeyRange})}); };
  const alice = open(), bob = open();
  const root = await alice.root();
  const other = await bob.root();
  const sources = {birth: "label '你好' 10", child: 'fw 2', foreign: 'fw 999'};
  const origin = writeSnap({root, source: sources.birth, title: 'birth', ts: {t: 1, n: 0}});
  const work = name(origin);
  const child = writeSnap({root, work_id: work, prev: work, source: sources.child, title: 'later', ts: {t: 2, n: 0}});
  const foreign = writeSnap({root: other, work_id: work, source: sources.foreign, title: 'claim', ts: {t: 999, n: 0}});
  await alice.put(origin, {authored: true}); await alice.put(child, {authored: true}); await bob.put(foreign, {authored: true});
  const proofs = {origin: await alice.proof(origin), child: await alice.proof(child), foreign: await bob.proof(foreign)};
  const genesis = await alice.genesis(), other_genesis = await bob.genesis();
  await alice.close(); await bob.close();
  console.log(JSON.stringify({root, other, origin, child, foreign, work, sources, proofs, genesis, other_genesis}));
  """

  @read ~S"""
  import assert from 'node:assert/strict';
  import { forkRef, pullKeep, pullWork, pullLegacy } from './assets/js/link.js';
  import { createJournal } from './assets/js/keep/journal.js';
  import { createEngine } from './assets/js/keep/journal.store.js';
  import { createMemoryIDB } from './test/js/keep/idb_memory.mjs';
  import { name } from './assets/js/keep/entry.js';
  const data = JSON.parse(process.argv[1]);
  globalThis.fetch = async path => {
    const response = data.responses[path];
    assert.ok(response, `unexpected fetch ${path}`);
    return {ok: response.status === 200, headers: {get: key => key === 'x-dojo-keep-read' ? response.reading : null}, json: async () => response.body};
  };
  const reports = [];
  for (const warm of [true, false]) for (const foreign of [false, true]) for (const reading of ['keep', 'work']) {
    const {idb, KeyRange} = createMemoryIDB();
    const engine = createEngine({idb, KeyRange, dbName: 'roundtrip', random: a => a.fill(foreign ? 8 : 7), stamp: () => ({t: 0, n: 0})});
    // Recovered public genesis restores read identity, not signing authority.
    await engine.genesis();
    const recovered = await new Promise((resolve, reject) => {
      const request = idb.open('roundtrip');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = recovered.transaction(['self'], 'readwrite');
      tx.objectStore('self').put(foreign ? data.other_genesis : data.genesis, 'genesis');
      tx.objectStore('self').delete('signing-key');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    recovered.close();
    const door = createJournal({engine});
    assert.equal(await door.root(), foreign ? data.other : data.root);
    try {
      if (warm) {
        await door.put(data.origin, {source: data.sources.birth, proof: data.proofs.origin});
        await door.put(data.child, {source: data.sources.child, proof: data.proofs.child});
        await door.put(data.foreign, {source: data.sources.foreign, proof: data.proofs.foreign});
      }
      const asks = [];
      const notes = [];
      const term = {
        forkKeep: ask => {asks.push({method: 'same', ...ask}); return 'same';},
        forkBuffer: ask => {asks.push({method: 'fork', ...ask}); return 'fork';},
      };
      const result = await forkRef(`${reading}:${data.work}`, {door, term, pull: pullKeep, pullWork, pullLegacy, say: (...args) => notes.push(args.join(' '))});
      assert.equal(result, foreign ? 'fork' : 'same');
      const expected = reading === 'keep' ? data.origin : data.child;
      const expectedSource = reading === 'keep' ? data.sources.birth : data.sources.child;
      assert.equal(asks.length, 1);
      assert.equal(asks[0].source, expectedSource);
      assert.equal(asks[0].base_id, name(expected));
      assert.equal(foreign ? asks[0].addr : asks[0].work_id, data.work);
      assert.equal(await door.get(name(expected)), expected);
      const expectedProof = data.proofs[reading === 'keep' ? 'origin' : 'child'];
      assert.deepEqual(await door.proof(expected), expectedProof);
      assert.equal(await door.source(name(expectedSource)), expectedSource);
      assert.ok(!notes.some(note => note.includes('legacy link reader')));
      reports.push({warm, foreign, reading, source: asks[0].source, base: asks[0].base_id});
    } finally {
      await door.close();
    }
  }
  console.log(JSON.stringify(reports));
  """

  test "origin ownership, exact/work intent and source survive the routed cross-runtime path" do
    data = node_json(@mint)
    work = data["work"]
    sources = data["sources"]

    assert Keep.hash(data["origin"]) == work
    assert accepted?(ship(data, "origin", sources["birth"]))
    assert accepted?(ship(data, "foreign", sources["foreign"]))
    assert accepted?(ship(data, "child", sources["child"]))
    assert Keep.owner_of(work) == data["root"]

    {rows, _} = Keep.history(work, of: :target)
    assert Enum.map(rows, & &1.id) == [Keep.hash(data["child"]), work]

    responses =
      for reading <- ["keep", "work"], into: %{} do
        path = "/keeps/#{work}?read=#{reading}"
        conn = build_conn() |> put_req_header("accept", "application/json") |> get(path)
        assert conn.status == 200
        assert get_resp_header(conn, "cache-control") == ["no-cache"]

        {path,
         %{
           status: conn.status,
           reading: List.first(get_resp_header(conn, "x-dojo-keep-read")),
           body: Jason.decode!(conn.resp_body)
         }}
      end

    reports = node_json(@read, [Jason.encode!(Map.put(data, "responses", responses))])
    assert length(reports) == 8

    assert Enum.count(reports, &(&1["reading"] == "keep" and &1["source"] == sources["birth"])) ==
             4

    assert Enum.count(reports, &(&1["reading"] == "work" and &1["source"] == sources["child"])) ==
             4
  end

  test "missing explicit reads revalidate, while unknown readings have no interpretation" do
    missing = String.duplicate("0", 64)

    for reading <- ["keep", "work", nil] do
      suffix = if reading, do: "?read=#{reading}", else: ""

      conn =
        build_conn()
        |> put_req_header("accept", "application/json")
        |> get("/keeps/#{missing}#{suffix}")

      assert conn.status == 404
      assert get_resp_header(conn, "x-dojo-keep-read") == [reading || "legacy"]
      assert get_resp_header(conn, "cache-control") == ["no-cache"]
    end

    conn =
      build_conn()
      |> put_req_header("accept", "application/json")
      |> get("/keeps/#{missing}?read=unknown")

    assert conn.status == 400
    assert get_resp_header(conn, "x-dojo-keep-read") == []
  end

  defp ship(data, key, source) do
    bytes = data[key]

    Keep.receive(
      %{
        "id" => Keep.hash(bytes),
        "message" => bytes,
        "source" => source,
        "proof" => data["proofs"][key]
      },
      clan: "roundtrip-room",
      author_id: "roundtrip-author"
    )
  end

  defp accepted?(reply), do: is_map(reply) and not Map.has_key?(reply, :why)

  defp node_json(script, args \\ []) do
    {output, status} = System.cmd("node", ["--input-type=module", "-e", script | args])
    assert status == 0, output
    Jason.decode!(String.trim(output))
  end
end
