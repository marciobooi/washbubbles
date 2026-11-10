import mongoose from 'mongoose'
import Machine from './models/machine.js'
import User from './models/user.js'
import Sale from './models/sale.js'

export async function connectMongo(uri) {
  console.log('Connecting to MongoDB:', String(uri).replace(/\/\/[^@/]*@/, '//***@')) // never the user and password
  await mongoose.connect(uri)
  console.log('MongoDB connected')
}

export { mongoose, Machine, User, Sale }
