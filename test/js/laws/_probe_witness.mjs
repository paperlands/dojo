import { buildWorld, fork, drive } from "./harness.mjs"
import { frameWorldTransform } from "../../../assets/js/turtling/scheduler.js"
import { AUTHORED } from "../../../assets/js/turtling/laws/authored.js"
import { sphere, cone, plane, point, meet } from "../../../assets/js/turtling/laws/meet.js"

const find = (f, n) => { if (f.name === n) return f; for (const c of f.children.values()) { const h = find(c, n); if (h) return h } return null }
const pos = (f) => f ? frameWorldTransform(f).position.map((n) => +n.toFixed(4)) : null

// (a) distance(A,B)=0 — a one-point locus, and it must not introduce.
const ctx = { worldOf: () => [3, 0, 0], livePoseOf: () => null, placementOf: () => null, frameOf: () => null }
const law0 = { feature: "distance", expression: { type: "distance", references: ["a", "b"], radius: 0 } }
const law5 = { feature: "distance", expression: { type: "distance", references: ["a", "b"], radius: 5 } }
console.log("(a) distance r=0 locus:", AUTHORED.distance.set(law0, { writerId: "a", ...ctx }).kind)
console.log("(a) distance r=5 locus:", AUTHORED.distance.set(law5, { writerId: "a", ...ctx }).kind)
// and through the scheduler, a fresh name is refused:
{
  const s = buildWorld({})
  const h = s.hotSwapChild("host", fork("host", "let distance(A, B) = 0"))
  drive(s)
  console.log("(a) let distance(A,B)=0 ->", h.error?.message ?? "no error", "| created:", !!(h.children.get("A")))
}

// (b) nested: plain declaration shadows; dotted position revises.
for (const [label, inner] of [["let A = (1,2,3)", "let A = (1,2,3)"], ["let A.position = (1,2,3)", "let A.position = (1,2,3)"]]) {
  const s = buildWorld({ admit: ({ requested }) => ({ accepted: true, transform: requested }) })
  const h = s.hotSwapChild("host", fork("host", ["let A", "as B do", "  " + inner, "end"].join("\n")))
  drive(s)
  const B = find(h, "B")
  console.log("(b)", label, "| B has A:", B.children.has("A"), "| B.A:", pos(B.children.get("A")), "| host.A:", pos(h.children.get("A")))
}

// (c) meet fold order.
const S = sphere([0, 0, 0], 5)
const C = cone([0, 0, 0], [0, 0, 1], 45)
const P = plane([0, 0, 5 / Math.SQRT2], [0, 0, 1])
console.log("(c) cone∩plane∩sphere:", meet(meet(C, P), S).kind, "| sphere∩cone∩plane:", meet(meet(S, C), P).kind)

// (d) tilt at apex: set membership vs measurement.
const apexIsMember = meet(point([0, 0, 0]), C).kind
const t = { type: "tilt", references: ["p"], frame: "f", value: 45 }
const tiltRead = AUTHORED.tilt.read({ feature: "tilt", expression: t }, [0, 0, 0], { placementOf: () => ({ position: [0, 0, 0], rotation: { x: 0, y: 0, z: 0, w: 1 } }) })
console.log("(d) apex in cone-set:", apexIsMember, "| tilt measurement at apex:", tiltRead)
