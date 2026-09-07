// Lightweight tenant-aware model wrapper helpers

/**
 * Sentinel filter used when no tenant could be resolved.
 *
 * The previous version dropped the filter entirely in that case, so an
 * unauthenticated request with no `X-Tenant-Id` read *every* tenant's machines,
 * prices and settings. A wrapper whose whole job is isolation must fail closed:
 * `tenantId` is `required` on every model, so matching null can never hit a row.
 */
const NO_TENANT = { tenantId: null }

export function withTenant(Model, req) {
  const tf = req && req.tenantId ? { tenantId: req.tenantId } : NO_TENANT

  return {
    find: (q = {}, ...rest) => Model.find({ ...q, ...tf }, ...rest),
    findOne: (q = {}, ...rest) => Model.findOne({ ...q, ...tf }, ...rest),
    findById: (id) => Model.findOne({ _id: id, ...tf }),
    findByIdAndUpdate: (id, update, opts = {}) => Model.findOneAndUpdate({ _id: id, ...tf }, update, opts),
    findOneAndUpdate: (q, update, opts = {}) => Model.findOneAndUpdate({ ...q, ...tf }, update, opts),
    findOneAndDelete: (q) => Model.findOneAndDelete({ ...q, ...tf }),
    findByIdAndDelete: (id) => Model.findOneAndDelete({ _id: id, ...tf }),
    updateMany: (q, update, opts = {}) => Model.updateMany({ ...q, ...tf }, update, opts),
    create: (doc) => {
      if (!req || !req.tenantId) throw new Error('Tenant not resolved')
      const d = Object.assign({}, doc, { tenantId: req.tenantId })
      return Model.create(d)
    },
    count: (q = {}) => Model.countDocuments({ ...q, ...tf }),
    /**
     * Prepend a tenant `$match` to an aggregation pipeline.
     * `withTenant` had no aggregate at all, so the analytics routes were using the
     * bare model and reporting every tenant's revenue to every admin.
     */
    aggregate: (pipeline = []) => Model.aggregate([{ $match: { ...tf } }, ...pipeline])
  }
}
