import { expect } from 'chai'
import { isBlankCard } from '../src/services/blankCard.js'

describe('blank card detection (a wiped chip can be reused)', () => {
  it('a card the reader calls new is blank', () => {
    expect(isBlankCard({ new: 'true', name: ' ', nif: ' ', balance: ' ' })).to.equal(true)
  })
  it('a wiped chip (no name, no tax id, no balance) is blank even though the reader says new:false', () => {
    expect(isBlankCard({ new: 'false', name: ' ', nif: ' ', balance: ' ' })).to.equal(true)
    expect(isBlankCard({ new: 'false', name: '', nif: '', balance: '' })).to.equal(true)
  })
  it('a card with a balance is never blank, not even 0', () => {
    expect(isBlankCard({ new: 'false', name: ' ', nif: ' ', balance: '500' })).to.equal(false)
    expect(isBlankCard({ new: 'false', name: ' ', nif: ' ', balance: '0' })).to.equal(false)
  })
  it('a card with a name or tax id is never blank', () => {
    expect(isBlankCard({ new: 'false', name: 'Ana', nif: ' ', balance: ' ' })).to.equal(false)
    expect(isBlankCard({ new: 'false', name: ' ', nif: '123456789', balance: ' ' })).to.equal(false)
  })
  it('an admin card is never blank', () => {
    expect(isBlankCard({ new: 'true', admin: 'true', name: ' ', nif: ' ', balance: ' ' })).to.equal(false)
  })
})
