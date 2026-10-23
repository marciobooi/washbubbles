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

/**
 * A user name must identify ONE person in the whole system (not only inside a shop), otherwise the login cannot know which of two
 * "dono" is meant. Case-insensitive. The index is only created when there are no duplicates yet (they are reported, never fixed
 * automatically); the API checks the same rule on every create/rename either way.
 * @returns {{status:'exists'|'created'|'duplicates', duplicates?:string[]}}
 */
export async function ensureGlobalUsernameIndex(UserModel) {
  const name = 'username_ci_unique'
  const idx = await UserModel.collection.indexes()
  if (idx.some((i) => i.name === name)) return { status: 'exists' }
  const dups = await UserModel.collection.aggregate([
    { $group: { _id: { $toLower: '$username' }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
  ]).toArray()
  if (dups.length) return { status: 'duplicates', duplicates: dups.map((d) => d._id) }
  await UserModel.collection.createIndex({ username: 1 }, { name, unique: true, collation: { locale: 'en', strength: 2 } })
  return { status: 'created' }
}

export const CI = { locale: 'en', strength: 2 }
/** Is this user name taken anywhere (any shop), ignoring capitals? `exceptId` lets a user keep their own name. */
export async function usernameTaken(UserModel, username, exceptId = null) {
  const q = { username: String(username) }
  if (exceptId) q._id = { $ne: exceptId }
  return Boolean(await UserModel.findOne(q).collation(CI).select('_id').lean())
}
