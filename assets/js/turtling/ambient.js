// The one evaluator↔ambient door: what the pure algebra and the executor need to know
// about the tree, injected as ONE object instead of accreting hooks at each call site.
// The evaluator keeps no frame knowledge; a caller that owns a frame builds this door
// and installs it once. Every operation is optional to the algebra — an evaluator with
// no door is a pure calculator (the profile and mafs tests rely on this).
//
// door = {
//   observe(command?)             begin an observation; revision, or undefined if unsupported
//   unobserved()                  end it
//   resolve(name, args)           resolve an external value (dotted read or callable)
//   subject(name)                 resolve a bare name to a being under nearest-binding, or undefined
//   own(name)                     this frame's OWN binding for a receiver selector, or undefined
//   owns(name)                    is the name declared in THIS frame (presence, not value)?
//   isSubject(value)              is this value a bound being?
//   facet(being, property, args)  read the being's facet through the one facet door
// }
//
// (id:being-facets-centers-review)
export function installAmbientDoor(evaluator, door) {
    evaluator.beginObservation = door.observe
    evaluator.endObservation = door.unobserved
    evaluator.resolveExternal = door.resolve
    evaluator.resolveSubject = door.subject
    evaluator.ownSubject = door.own
    evaluator.owns = door.owns
    evaluator.isSubject = door.isSubject
    evaluator.resolveSubjectFacet = door.facet
    return evaluator
}
