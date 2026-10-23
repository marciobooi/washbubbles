/**
 * Indexes that Mongoose will not replace on its own.
 *
 * The users collection was first created with a plain unique index on (tenantId, email). Every user without an email stores
 * `email: null`, so the SECOND such user in a tenant failed with E11000 duplicate key ("Request timed out" in the admin).
 * The model now declares the right index (unique only where email is a string), but Mongo keeps an existing index of the
 * same name untouched. This drops the old one and creates the right one; it does nothing when the index is already right.
 */
export async function ensureUserIndexes(UserModel) {
  const fixed = []
  const idx = await UserModel.collection.indexes()
  for (const [name, key] of [['tenantId_1_email_1', { tenantId: 1, email: 1 }], ['tenantId_1_apiKey_1', { tenantId: 1, apiKey: 1 }]]) {
    const cur = idx.find((i) => i.name === name)
    if (cur && !cur.partialFilterExpression) {
      await UserModel.collection.dropIndex(name)
      const field = Object.keys(key)[1]
      await UserModel.collection.createIndex(key, { name, unique: true, partialFilterExpression: { [field]: { $type: 'string' } } })
      fixed.push(name)
    }
  }
  return fixed
}
