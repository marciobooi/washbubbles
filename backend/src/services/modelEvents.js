/**
 * Tiny in-process event bus for "a record was created" notifications.
 *
 * Models emit here from their post-save hooks; services (the central uplink)
 * subscribe. It keeps the models free of imports from services, which would be
 * circular.
 */
import EventEmitter from 'events'

const modelEvents = new EventEmitter()
// Several long-lived subscribers are normal; do not warn about them.
modelEvents.setMaxListeners(20)

export default modelEvents
