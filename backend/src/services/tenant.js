// Lightweight tenant-aware model wrapper helpers
export function withTenant(Model, req) {
  const tf = req && req.tenantId ? { tenantId: req.tenantId } : null

  return {
    find: (q = {}, ...rest) => Model.find(tf ? { ...q, ...tf } : q, ...rest),
    findOne: (q = {}, ...rest) => Model.findOne(tf ? { ...q, ...tf } : q, ...rest),
    findById: (id) => Model.findOne(tf ? { _id: id, ...tf } : { _id: id }),
    findByIdAndUpdate: (id, update, opts = {}) => Model.findOneAndUpdate(tf ? { _id: id, ...tf } : { _id: id }, update, opts),
    findOneAndUpdate: (q, update, opts = {}) => Model.findOneAndUpdate(tf ? { ...q, ...tf } : q, update, opts),
    findOneAndDelete: (q) => Model.findOneAndDelete(tf ? { ...q, ...tf } : q),
    findByIdAndDelete: (id) => Model.findOneAndDelete(tf ? { _id: id, ...tf } : { _id: id }),
    create: (doc) => {
      if (!tf) throw new Error('Tenant not resolved')
      const d = Object.assign({}, doc, { tenantId: tf.tenantId })
      return Model.create(d)
    },
    count: (q = {}) => Model.countDocuments(tf ? { ...q, ...tf } : q)
  }
}
