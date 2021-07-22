/* eslint-disable @typescript-eslint/no-var-requires,no-undef */
const {
  expectEvent,
  expectRevert,
  balance,
  constants
} = require('@openzeppelin/test-helpers')
const { deployProxy, silenceWarnings } = require('@openzeppelin/truffle-upgrades')
const { toBN, asciiToHex, padRight } = require('web3-utils')
const expect = require('chai').expect

const Staking = artifacts.require('Staking')
const StorageManager = artifacts.require('StorageManager')
const ERC20 = artifacts.require('MockERC20')

contract('Staking', ([randomPerson, staker]) => {
  let token
  let storageManager
  let staking

  before(async () => {
    await silenceWarnings()
  })

  beforeEach(async function () {
    // Deploy Storage Manager
    storageManager = await deployProxy(StorageManager, [], { unsafeAllowCustomTypes: true })

    // Deploy token
    token = await ERC20.new('myToken', 'mT', randomPerson, 100000, { from: randomPerson })
    // Deploy Staking
    staking = await Staking.new(storageManager.address, { from: randomPerson })
    // White list token
    await storageManager.setWhitelistedTokens(token.address, true, { from: randomPerson })
    await staking.setWhitelistedTokens(token.address, true, { from: randomPerson })
    // White list native token
    await staking.setWhitelistedTokens(constants.ZERO_ADDRESS, true, { from: randomPerson })
    await storageManager.setWhitelistedTokens(constants.ZERO_ADDRESS, true, { from: randomPerson })
    // White list provider
    await storageManager.setWhitelistedProvider(staker, true, { from: randomPerson })

    // distribute tokens
    await token.transfer(staker, 10000, { from: randomPerson })
  })

  describe('setWhitelistedTokens', () => {
    it('should throw when try to add token from not owner', async () => {
      await expectRevert(staking.setWhitelistedTokens(token.address, true, { from: staker }), 'Ownable: caller is not the owner')
    })
    it('owner should be able to white list token', async () => {
      await staking.setWhitelistedTokens(token.address, false, { from: randomPerson })
      const isWhiteListed = await staking.isInWhiteList(token.address)
      expect(isWhiteListed).to.eql(false)
    })
    it('owner should be able to white list native token', async () => {
      await staking.setWhitelistedTokens(constants.ZERO_ADDRESS, false, { from: randomPerson })
      expect(await staking.isInWhiteList(constants.ZERO_ADDRESS)).to.eql(false)
      await staking.setWhitelistedTokens(constants.ZERO_ADDRESS, true, { from: randomPerson })
      expect(await staking.isInWhiteList(constants.ZERO_ADDRESS)).to.eql(true)
    })
  })

  describe('stakeNative', () => {
    it('should process a stake', async () => {
      const sender = staker
      const toStake = 5000
      // track balance
      const initialBalance = await balance.current(staker)
      // should start at 0
      expect((await staking.totalStakedFor(sender, constants.ZERO_ADDRESS)).toNumber()).to.eql(0)
      // stake
      const receipt = await staking.stake(0, constants.ZERO_ADDRESS, constants.ZERO_BYTES32, { from: sender, value: toStake, gasPrice: 0 })
      // should emit event
      expectEvent(receipt, 'Staked', {
        user: sender,
        amount: '5000',
        total: '5000',
        token: constants.ZERO_ADDRESS,
        data: constants.ZERO_BYTES32
      })
      // should update staked value
      expect((await staking.totalStakedFor(sender, constants.ZERO_ADDRESS)).toNumber()).to.eql(toStake)
      // should update initial balance
      const nextBalance = await balance.current(staker)
      expect(initialBalance.sub(toBN(5000))).to.eql(nextBalance)
    })
    it('should throw if native token not whitelisted', async () => {
      const sender = staker
      const toStake = 5000
      // track balance
      const initialBalance = await balance.current(staker)
      // should start at 0
      expect((await staking.totalStakedFor(sender, constants.ZERO_ADDRESS)).toNumber()).to.eql(0)
      // Black list token
      await staking.setWhitelistedTokens(constants.ZERO_ADDRESS, false, { from: randomPerson })
      // stake
      await expectRevert(staking.stake(0, constants.ZERO_ADDRESS, constants.ZERO_BYTES32, { from: sender, value: toStake, gasPrice: 0 }), 'Staking: not possible to interact with this token')
      // should not update staked value
      expect((await staking.totalStakedFor(sender, constants.ZERO_ADDRESS)).toNumber()).to.eql(0)
      // should not update initial balance
      const nextBalance = await balance.current(staker)
      expect(initialBalance).to.eql(nextBalance)
    })
  })

  describe('stakeToken', () => {
    it('should process a stake', async () => {
      const sender = staker
      const toStake = 5000
      // track balance
      const initialBalance = await token.balanceOf(staker)
      // should start at 0
      expect((await staking.totalStakedFor(sender, token.address)).toNumber()).to.eql(0)
      // allow token
      await token.approve(staking.address, toStake, { from: sender })
      // stake
      const receipt = await staking.stake(toStake, token.address, constants.ZERO_BYTES32, { from: sender, gasPrice: 0 })
      // should emit event
      expectEvent(receipt, 'Staked', {
        user: sender,
        amount: '5000',
        total: '5000',
        token: token.address,
        data: constants.ZERO_BYTES32
      })
      // should update staked value
      expect((await staking.totalStakedFor(sender, token.address)).toNumber()).to.eql(toStake)
      // should update initial balance
      const nextBalance = await token.balanceOf(staker)
      expect(initialBalance.sub(toBN(toStake))).to.eql(nextBalance.sub(toBN(0)))
    })
    it('should throw if token not whitelisted', async () => {
      const sender = staker
      const toStake = 5000
      // track balance
      const initialBalance = await token.balanceOf(staker)
      // should start at 0
      expect((await staking.totalStakedFor(sender, token.address)).toNumber()).to.eql(0)
      // Black list token
      await staking.setWhitelistedTokens(token.address, false, { from: randomPerson })
      // stake
      await expectRevert(staking.stake(toStake, token.address, constants.ZERO_BYTES32, { from: sender, gasPrice: 0 }), 'Staking: not possible to interact with this token')
      // should not update staked value
      expect((await staking.totalStakedFor(sender, token.address)).toNumber()).to.eql(0)
      // should not update initial balance
      const nextBalance = await token.balanceOf(staker)
      expect(initialBalance).to.eql(nextBalance)
    })
  })

  describe('stakeForNative', () => {
    it('should process a stake', async () => {
      const stakeFor = staker
      const sender = staker
      const toStake = 5000
      // track balance
      const initialBalance = await balance.current(staker)
      // should start at 0
      expect((await staking.totalStakedFor(stakeFor, constants.ZERO_ADDRESS)).toNumber()).to.eql(0)
      // stake
      const receipt = await staking.stakeFor(0, stakeFor, constants.ZERO_ADDRESS, constants.ZERO_BYTES32, { from: sender, value: toStake, gasPrice: 0 })
      // should emit event
      expectEvent(receipt, 'Staked', {
        user: sender,
        amount: '5000',
        total: '5000',
        token: constants.ZERO_ADDRESS,
        data: constants.ZERO_BYTES32
      })
      // should update staked value
      expect((await staking.totalStakedFor(stakeFor, constants.ZERO_ADDRESS)).toNumber()).to.eql(toStake)
      // should update initial balance
      const nextBalance = await balance.current(staker)
      expect(initialBalance.sub(toBN(5000))).to.eql(nextBalance)
    })
    it('should throw if token not whitelisted', async () => {
      const stakeFor = staker
      const sender = staker
      const toStake = 5000
      // track balance
      const initialBalance = await balance.current(staker)
      // should start at 0
      expect((await staking.totalStakedFor(stakeFor, constants.ZERO_ADDRESS)).toNumber()).to.eql(0)
      // Black list token
      await staking.setWhitelistedTokens(constants.ZERO_ADDRESS, false, { from: randomPerson })
      // stake
      await expectRevert(staking.stakeFor(0, stakeFor, constants.ZERO_ADDRESS, constants.ZERO_BYTES32, { from: sender, value: toStake, gasPrice: 0 }), 'Staking: not possible to interact with this token')
      // should not update staked value
      expect((await staking.totalStakedFor(stakeFor, constants.ZERO_ADDRESS)).toNumber()).to.eql(0)
      // should not update initial balance
      const nextBalance = await balance.current(staker)
      expect(initialBalance).to.eql(nextBalance)
    })
  })

  describe('stakeForToken', () => {
    it('should process a stake', async () => {
      const stakeFor = staker
      const sender = staker
      const toStake = 5000
      // track balance
      const initialBalance = await token.balanceOf(staker)
      // should start at 0
      expect((await staking.totalStakedFor(stakeFor, token.address)).toNumber()).to.eql(0)
      // allow token
      await token.approve(staking.address, toStake, { from: sender })
      // stake
      const receipt = await staking.stakeFor(toStake, stakeFor, token.address, constants.ZERO_BYTES32, { from: sender, gasPrice: 0 })
      // should emit event
      expectEvent(receipt, 'Staked', {
        user: sender,
        amount: '5000',
        total: '5000',
        token: token.address,
        data: constants.ZERO_BYTES32
      })
      // should update staked value
      expect((await staking.totalStakedFor(stakeFor, token.address)).toNumber()).to.eql(toStake)
      // should update initial balance
      const nextBalance = await token.balanceOf(staker)
      expect(initialBalance.sub(toBN(5000))).to.eql(nextBalance.sub(toBN(0)))
    })
    it('should throw if token not whitelisted', async () => {
      const stakeFor = staker
      const sender = staker
      const toStake = 5000
      // track balance
      const initialBalance = await token.balanceOf(staker)
      // should start at 0
      expect((await staking.totalStakedFor(stakeFor, constants.ZERO_ADDRESS)).toNumber()).to.eql(0)
      // Black list token
      await staking.setWhitelistedTokens(constants.ZERO_ADDRESS, false, { from: randomPerson })
      // stake
      await expectRevert(staking.stakeFor(toStake, stakeFor, constants.ZERO_ADDRESS, constants.ZERO_BYTES32, { from: sender, gasPrice: 0 }), 'Staking: not possible to interact with this token')
      // should not update staked value
      expect((await staking.totalStakedFor(stakeFor, constants.ZERO_ADDRESS)).toNumber()).to.eql(0)
      // should not update initial balance
      const nextBalance = await token.balanceOf(staker)
      expect(initialBalance).to.eql(nextBalance)
    })
  })

  describe('unstakeNative', () => {
    it('should not unstake when storage offer active', async () => {
      const toStake = 5000
      // set StorageOffer by staker
      await storageManager.setOffer(1000, [[10, 100]], [[10, 80]], [constants.ZERO_ADDRESS], [padRight(asciiToHex('testMessage'))], { from: staker })
      // newAgreement by randomPerson
      await storageManager.newAgreement([asciiToHex('/ipfs/QmSomeHash')], staker, 100, 10, constants.ZERO_ADDRESS, 0, [], [], constants.ZERO_ADDRESS, { from: randomPerson, value: 2000 })
      // stake
      await staking.stake(0, constants.ZERO_ADDRESS, constants.ZERO_BYTES32, { from: staker, value: toStake, gasPrice: 0 })
      // attempt to unstake
      await expectRevert(staking.unstake(toStake, constants.ZERO_ADDRESS, constants.ZERO_BYTES32, { from: staker }), 'Staking: must have no utilized capacity in StorageManager')
    })

    it('should not unstake when nothing was staked before', async () => {
      // somebody else staked before, so funds are placed in the contract
      await staking.stake(0, constants.ZERO_ADDRESS, constants.ZERO_BYTES32, { from: randomPerson, value: 5000, gasPrice: 0 })

      await expectRevert(staking.unstake(3000, constants.ZERO_ADDRESS, constants.ZERO_BYTES32, { from: staker }), 'SafeMath: subtraction overflow')
    })

    it('should process an unstake when no active offer', async () => {
      const toStake = 5000
      const initialBalance = await balance.current(staker)
      await staking.stake(0, constants.ZERO_ADDRESS, constants.ZERO_BYTES32, { from: staker, value: toStake, gasPrice: 0 })
      const receipt = await staking.unstake(toStake, constants.ZERO_ADDRESS, constants.ZERO_BYTES32, { from: staker, gasPrice: 0 })
      const nextBalance = await balance.current(staker)
      // should emit event
      expectEvent(receipt, 'Unstaked', {
        user: staker,
        amount: '5000',
        total: '0',
        token: constants.ZERO_ADDRESS,
        data: constants.ZERO_BYTES32
      })
      // final balance equal to initial balance
      expect(initialBalance).to.eql(nextBalance)
    })

    it('should throw when token black listed', async () => {
      const toStake = 5000
      const initialBalance = await balance.current(staker)
      await staking.stake(0, constants.ZERO_ADDRESS, constants.ZERO_BYTES32, { from: staker, value: toStake, gasPrice: 0 })
      // Blacklist token
      await staking.setWhitelistedTokens(constants.ZERO_ADDRESS, false, { from: randomPerson })
      await expectRevert(staking.unstake(toStake, constants.ZERO_ADDRESS, constants.ZERO_BYTES32, { from: staker, gasPrice: 0 }), 'Staking: not possible to interact with this token')
      const nextBalance = await balance.current(staker)
      // final balance equal to initial balance
      expect(initialBalance.toString()).to.eql(nextBalance.add(toBN(toStake)).toString())
    })
  })

  describe('unstakeToken', () => {
    it('should not unstake when storage offer active', async () => {
      const toStake = 5000
      await token.approve(storageManager.address, 2000, { from: staker })
      // set StorageOffer by staker
      await storageManager.setOffer(1000, [[10, 100]], [[10, 80]], [token.address], [padRight(asciiToHex('testMessage'))], { from: staker })
      // newAgreement by randomPerson
      await storageManager.newAgreement([asciiToHex('/ipfs/QmSomeHash')], staker, 100, 10, token.address, 2000, [], [], token.address, { from: staker })
      // approve
      await token.approve(staking.address, toStake, { from: staker })
      // stake
      await staking.stake(toStake, token.address, constants.ZERO_BYTES32, { from: staker, gasPrice: 0 })
      // attempt to unstake
      await expectRevert(staking.unstake(toStake, token.address, constants.ZERO_BYTES32, { from: staker }), 'Staking: must have no utilized capacity in StorageManager')
    })
    it('should not unstake when nothing was staked before', async () => {
      // somebody else staked before, so funds are placed in the contract
      await token.approve(staking.address, 5000, { from: randomPerson })
      await staking.stake(5000, token.address, constants.ZERO_BYTES32, { from: randomPerson, gasPrice: 0 })

      await expectRevert(staking.unstake(3000, token.address, constants.ZERO_BYTES32, { from: staker }), 'SafeMath: subtraction overflow')
    })
    it('should process an unstake when no active offer', async () => {
      const toStake = 5000
      const initialBalance = await token.balanceOf(staker)
      // approve
      await token.approve(staking.address, toStake, { from: staker })
      await staking.stake(toStake, token.address, constants.ZERO_BYTES32, { from: staker, gasPrice: 0 })
      const receipt = await staking.unstake(toStake, token.address, constants.ZERO_BYTES32, { from: staker, gasPrice: 0 })
      const nextBalance = await token.balanceOf(staker)
      // should emit event
      expectEvent(receipt, 'Unstaked', {
        user: staker,
        amount: '5000',
        total: '0',
        token: token.address,
        data: constants.ZERO_BYTES32
      })
      // final balance equal to initial balance
      expect(initialBalance).to.eql(nextBalance)
    })
    it('should throw when token black listed', async () => {
      const toStake = 5000
      const initialBalance = await token.balanceOf(staker)
      // approve
      await token.approve(staking.address, toStake, { from: staker })
      await staking.stake(toStake, token.address, constants.ZERO_BYTES32, { from: staker, gasPrice: 0 })
      // Blacklist token
      await staking.setWhitelistedTokens(token.address, false, { from: randomPerson })
      await expectRevert(staking.unstake(toStake, token.address, constants.ZERO_BYTES32, { from: staker, gasPrice: 0 }), 'Staking: not possible to interact with this token')
      const nextBalance = await token.balanceOf(staker)
      // final balance equal to initial balance
      expect(initialBalance.toString()).to.eql(nextBalance.add(toBN(toStake)).toString())
    })
  })

  describe('totalStakedNative', () => {
    it('should return total staked when staked 0', async () => {
      expect(toBN(await staking.totalStaked(constants.ZERO_ADDRESS))).to.be.bignumber.equal(toBN(0))
    })
    it('should return total staked when staked', async () => {
      const toStake = 5000
      await staking.stake(0, constants.ZERO_ADDRESS, constants.ZERO_BYTES32, { from: staker, value: toStake, gasPrice: 0 })
      expect(toBN(await staking.totalStaked(constants.ZERO_ADDRESS))).to.be.bignumber.equal(toBN(toStake))
    })
    it('should return total staked when staked and unstaked', async () => {
      const toStake = 5000
      const toUnstake = 2500
      // stake
      await staking.stake(0, constants.ZERO_ADDRESS, constants.ZERO_BYTES32, { from: staker, value: toStake, gasPrice: 0 })
      // unstake
      await staking.unstake(toUnstake, constants.ZERO_ADDRESS, constants.ZERO_BYTES32, { from: staker, gasPrice: 0 })
      expect(toBN(await staking.totalStaked(constants.ZERO_ADDRESS))).to.be.bignumber.equal(toBN(toStake - toUnstake))
    })
  })

  describe('totalStakedToken', () => {
    it('should return total staked when staked 0', async () => {
      expect(toBN(await staking.totalStaked(token.address))).to.be.bignumber.equal(toBN(0))
    })
    it('should return total staked when staked', async () => {
      const toStake = 5000
      // approve
      await token.approve(staking.address, toStake, { from: staker })
      // stake
      await staking.stake(toStake, token.address, constants.ZERO_BYTES32, { from: staker, gasPrice: 0 })
      expect(toBN(await staking.totalStaked(token.address))).to.be.bignumber.equal(toBN(toStake))
    })
    it('should return total staked when staked and unstaked', async () => {
      const toStake = 5000
      const toUnstake = 2500
      // approve
      await token.approve(staking.address, toStake, { from: staker })
      // stake
      await staking.stake(toStake, token.address, constants.ZERO_BYTES32, { from: staker, gasPrice: 0 })
      // unstake
      await staking.unstake(toUnstake, token.address, constants.ZERO_BYTES32, { from: staker, gasPrice: 0 })
      expect(toBN(await staking.totalStaked(token.address))).to.be.bignumber.equal(toBN(toStake - toUnstake))
    })
  })

  describe('totalStakedForNative', () => {
    it('should return total staked when staked 0', async () => {
      expect(toBN(await staking.totalStakedFor(staker, constants.ZERO_ADDRESS))).to.be.bignumber.equal(toBN(0))
    })
    it('should return total staked when staked', async () => {
      const toStake = 5000
      await staking.stake(0, constants.ZERO_ADDRESS, constants.ZERO_BYTES32, { from: staker, value: toStake, gasPrice: 0 })
      expect(toBN(await staking.totalStakedFor(staker, constants.ZERO_ADDRESS))).to.be.bignumber.equal(toBN(toStake))
    })
    it('should return total staked when staked and unstaked', async () => {
      const toStake = 5000
      const toUnstake = 2500
      // stake
      await staking.stake(0, constants.ZERO_ADDRESS, constants.ZERO_BYTES32, { from: staker, value: toStake, gasPrice: 0 })
      // unstake
      await staking.unstake(toUnstake, constants.ZERO_ADDRESS, constants.ZERO_BYTES32, { from: staker, gasPrice: 0 })
      expect(toBN(await staking.totalStakedFor(staker, constants.ZERO_ADDRESS))).to.be.bignumber.equal(toBN(toStake - toUnstake))
    })
  })

  describe('totalStakedForToken', () => {
    it('should return total staked when staked 0', async () => {
      expect(toBN(await staking.totalStakedFor(staker, token.address))).to.be.bignumber.equal(toBN(0))
    })
    it('should return total staked when staked', async () => {
      const toStake = 5000
      // approve
      await token.approve(staking.address, toStake, { from: staker })
      // stake
      await staking.stake(toStake, token.address, constants.ZERO_BYTES32, { from: staker, gasPrice: 0 })
      expect(toBN(await staking.totalStakedFor(staker, token.address))).to.be.bignumber.equal(toBN(toStake))
    })
    it('should return total staked when staked and unstaked', async () => {
      const toStake = 5000
      const toUnstake = 2500
      // approve
      await token.approve(staking.address, toStake, { from: staker })
      // stake
      await staking.stake(toStake, token.address, constants.ZERO_BYTES32, { from: staker, gasPrice: 0 })
      // unstake
      await staking.unstake(toUnstake, token.address, constants.ZERO_BYTES32, { from: staker, gasPrice: 0 })
      expect(toBN(await staking.totalStakedFor(staker, token.address))).to.be.bignumber.equal(toBN(toStake - toUnstake))
    })
  })
})
