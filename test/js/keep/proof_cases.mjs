// Public, disposable corpus shared by the JS cache and OTP admission tests.
import { signingHand, KEEP_PROOF_DOMAIN } from "../../../assets/js/keep/auth.js"
import { genesisBytes } from "../../../assets/js/keep/genesis.js"
import { name, write } from "../../../assets/js/keep/entry.js"

export async function proofCases() {
    const hand = await signingHand()
    const birth = genesisBytes((a) => a.fill(7), { t: 0, n: 0 }, hand.auth)
    const message = (genesis) => write("snap", {
        title: '你好 🌱 : "root" { [ ] }',
        values: [0.25, -1.5, { v: 1.5, ts: { t: 2.5 } }],
    }, { root: name(genesis), ts: { t: 1, n: 0 } })
    const cases = []
    const add = async (label, genesis, bytes, valid, alter = (proof) => proof) => {
        const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" },
            hand.privateKey, new TextEncoder().encode(KEEP_PROOF_DOMAIN + bytes))
        const proof = alter({ v: 1, genesis, signature: Buffer.from(signature).toString("hex") })
        cases.push({ label, valid, payload: { id: name(bytes), message: bytes, proof } })
    }
    const bytes = message(birth)
    await add("valid nested floats, escaped strings and Unicode", birth, bytes, true)
    const pretty = JSON.stringify(JSON.parse(birth), null, 2)
    await add("noncanonical genesis whitespace", pretty, message(pretty), true)
    const negativeZero = birth.replace('"t":0', '"t":-0')
    await add("integer negative zero", negativeZero, message(negativeZero), true)
    await add("invalid signature", birth, bytes, false, (p) => ({ ...p, signature: "0".repeat(128) }))
    await add("unknown proof version", birth, bytes, false, (p) => ({ ...p, v: 2 }))
    await add("proof extension is not silently interpreted", birth, bytes, false, (p) => ({ ...p, extra: true }))
    await add("uppercase signature", birth, bytes, false, (p) => ({ ...p, signature: p.signature.toUpperCase() }))
    await add("wrong root", birth, bytes.replace(name(birth), "f".repeat(64)), false)
    await add("duplicate nested keys", birth, bytes.replace('"values":', '"body":[{"x":1,"x":2}],"values":'), false)
    await add("escaped duplicate root key", birth, bytes.replace('"root":', '"ro\\u006ft":"other","root":'), false)
    await add("floating message clock", birth, bytes.replace('"t":1', '"t":1.0'), false)
    await add("exponential message clock", birth, bytes.replace('"t":1', '"t":1e0'), false)
    await add("unpaired Unicode escape", birth, bytes.replace('"values":', '"bad":"\\ud800","values":'), false)
    await add("signed oversized UTF-8 message", birth, bytes.replace('"values":', '"big":"' + "é".repeat(128 * 1024) + '","values":'), false)
    await add("maximum exact message clock", birth, bytes.replace('"t":1', '"t":9007199254740991'), true)
    await add("rounded message clock", birth, bytes.replace('"t":1', '"t":9007199254740992'), false)
    await add("distinct clock lost in JS", birth, bytes.replace('"t":1', '"t":9007199254740993'), false)
    await add("SQLite integer overflow clock", birth, bytes.replace('"t":1', '"t":9223372036854775808'), false)
    await add("unsafe message counter", birth, bytes.replace('"n":0', '"n":9007199254740992'), false)
    await add("unsafe message version", birth, bytes.replace('"v":1,', '"v":9007199254740992,'), false)
    await add("maximum exact message version", birth, bytes.replace('"v":1,', '"v":9007199254740991,'), true)
    await add("overflowing opaque float", birth, bytes.replace('"values":', '"float":1e400,"values":'), false)
    await add("opaque integer remains exact bytes", birth, bytes.replace('"values":', '"integer":1' + "0".repeat(400) + ',"values":'), true)
    await add("underflowing opaque float", birth, bytes.replace('"values":', '"float":1e-400,"values":'), true)
    await add("equivalent signature is not another fact", birth, bytes, true, equivalentProof)
    for (const [label, clock, valid] of [
        ["maximum exact genesis clock", "9007199254740991", true],
        ["unsafe genesis clock", "9007199254740992", false],
        ["unsafe genesis counter", "9007199254740993", false],
    ]) {
        const altered = birth.replace(label.includes("counter") ? '"n":0' : '"t":0',
            label.includes("counter") ? '"n":' + clock : '"t":' + clock)
        await add(label, altered, message(altered), valid)
    }

    for (const [label, altered] of [
        ["duplicate genesis keys", birth.replace('"kind":', '"v":1,"kind":')],
        ["floating genesis clock", birth.replace('"t":0', '"t":0.0')],
        ["floating auth version", birth.replace('"auth":{"v":1', '"auth":{"v":1.0')],
        ["unpaired genesis Unicode", birth.replace('"kind":', '"bad":"\\ud800","kind":')],
        ["unknown suite", birth.replace("P256-SHA256", "Ed25519")],
        ["off-curve point", birth.replace(hand.auth.public_key, "04" + "0".repeat(128))],
        ["oversized UTF-8 genesis", birth.replace('"kind":', '"big":"' + "é".repeat(32 * 1024) + '","kind":')],
    ]) await add(label, altered, message(altered), false)
    return cases
}

export function equivalentProof(proof) {
    const order = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n
    const s = order - BigInt("0x" + proof.signature.slice(64))
    return { ...proof, signature: proof.signature.slice(0, 64) + s.toString(16).padStart(64, "0") }
}
