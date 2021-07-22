/* eslint-disable @typescript-eslint/no-var-requires,no-undef */
const { soliditySha3 } = require('web3-utils')
const {
  upgradeProxy, deployProxy,
  admin: { transferProxyAdminOwnership }, silenceWarnings
} = require('@openzeppelin/truffle-upgrades')
const {
  expectEvent,
  expectRevert,
  constants
} = require('@openzeppelin/test-helpers')
const { asciiToHex, padRight } = require('web3-utils')
const { expect } = require('chai')

const StorageManager = artifacts.require('TestStorageManager')
const StorageManagerV2 = artifacts.require('TestStorageManagerV2')

const ERC20 = artifacts.require('MockERC20')

function getAgreementReference (receipt) {
  const newAgreementEvent = receipt.logs.find(e => e.event === 'NewAgreement')
  return soliditySha3(newAgreementEvent.args.agreementCreator, ...newAgreementEvent.args.dataReference, newAgreementEvent.args.token)
}

contract('StorageManager', ([Owner, Consumer, Provider, Provider2]) => {
  let storageManager
  let token
  const cid = [asciiToHex('/ipfs/pr9SPwWuctUmBkDVOxgtM1uiY8')]

  const init = async (Owner, Consumer, Provider) => {
    storageManager = await deployProxy(StorageManager, [], { unsafeAllowCustomTypes: true })
    token = await ERC20.new('myToken', 'mT', Owner, 100000, { from: Owner })

    await storageManager.setWhitelistedTokens(constants.ZERO_ADDRESS, true, { from: Owner })
    await storageManager.setWhitelistedTokens(token.address, true, { from: Owner })

    await storageManager.setWhitelistedProvider(Provider, true, { from: Owner })

    await token.transfer(Consumer, 10000, { from: Owner })

    await storageManager.setTime(100)
  }

  before(async () => {
    await silenceWarnings()
    await init(Owner, Consumer, Provider)
  })

  async function expectUtilizedCapacity (capacity) {
    expect((await storageManager.getOfferUtilizedCapacity(Provider)).toNumber()).to.eql(capacity)
  }

  describe('White list of providers', () => {
    it('should not be able to create an offer if not whitelisted', async () => {
      const msg = [padRight(asciiToHex('some string'), 64), padRight(asciiToHex('some other string'), 64)]
      await expectRevert(storageManager.setOffer(1000, [[10, 100], [20, 100]], [[10, 80], [20, 80]], [constants.ZERO_ADDRESS, token.address], msg, { from: Provider2 }),
        'StorageManager: provider is not whitelisted'
      )
    })
    it('should not be able to whitelist provider by not owner', async () => {
      await expectRevert(storageManager.setWhitelistedProvider(Provider2, true, { from: Provider2 }), 'Ownable: caller is not the owner')
    })
    it('should be able create offer by whitelisted provider', async () => {
      await storageManager.setWhitelistedProvider(Provider2, true, { from: Owner })

      const msg = [padRight(asciiToHex('some string'), 64), padRight(asciiToHex('some other string'), 64)]
      const receipt = await storageManager.setOffer(1000, [[10, 100], [20, 100]], [[10, 80], [20, 80]], [constants.ZERO_ADDRESS, token.address], msg, { from: Provider2 })

      expectEvent(receipt, 'TotalCapacitySet', {
        provider: Provider2,
        capacity: '1000'
      })
      expectEvent(receipt, 'BillingPlanSet', {
        provider: Provider2,
        token: constants.ZERO_ADDRESS,
        period: '10',
        price: '10'
      })
      expectEvent(receipt, 'BillingPlanSet', {
        provider: Provider2,
        token: token.address,
        period: '20',
        price: '20'
      })
      expectEvent(receipt, 'BillingPlanSet', {
        provider: Provider2,
        token: constants.ZERO_ADDRESS,
        period: '100',
        price: '80'
      })
      expectEvent(receipt, 'BillingPlanSet', {
        provider: Provider2,
        token: token.address,
        period: '100',
        price: '80'
      })

      // TODO: Waiting for support of asserting arrays to be released for validation of emitted message.
      expectEvent(receipt, 'MessageEmitted')

      await storageManager.setWhitelistedProvider(Provider2, false, { from: Owner })
    })
    it('should not be able to update capacity if not white listed', async () => {
      await storageManager.setWhitelistedProvider(Provider2, true, { from: Owner })
      await storageManager.setOffer(1000, [[10, 100]], [[10, 80]], [constants.ZERO_ADDRESS], [], { from: Provider2 })
      await storageManager.setWhitelistedProvider(Provider2, false, { from: Owner })

      await expectRevert(
        storageManager.setTotalCapacity(1000, { from: Provider2 }),
        'StorageManager: provider is not whitelisted'
      )
    })
    it('should not be able to update billing plans if not white listed', async () => {
      await storageManager.setWhitelistedProvider(Provider2, true, { from: Owner })
      await storageManager.setOffer(1000, [[10, 100]], [[10, 80]], [constants.ZERO_ADDRESS], [], { from: Provider2 })
      await storageManager.setWhitelistedProvider(Provider2, false, { from: Owner })

      await expectRevert(
        storageManager.setBillingPlans([[10, 100]], [[10, 80]], [constants.ZERO_ADDRESS], { from: Provider2 }),
        'StorageManager: provider is not whitelisted'
      )
    })
    it('should not be able to terminate offer which provider not whitelisted', async () => {
      await storageManager.setWhitelistedProvider(Provider2, true, { from: Owner })
      await storageManager.setOffer(1000, [[10, 100]], [[10, 80]], [constants.ZERO_ADDRESS], [], { from: Provider2 })
      await storageManager.setWhitelistedProvider(Provider2, false, { from: Owner })

      await expectRevert(
        storageManager.terminateOffer({ from: Provider2 }),
        'StorageManager: provider is not whitelisted'
      )
    })
    it('should not be able to payout funds from offer which provider not whitelisted', async () => {
      await storageManager.setWhitelistedProvider(Provider2, true, { from: Owner })
      await storageManager.setOffer(1000, [[1, 100]], [[10, 80]], [constants.ZERO_ADDRESS], [], { from: Provider2 })
      await storageManager.newAgreement(cid, Provider2, 100, 1, constants.ZERO_ADDRESS, 0, [], [], constants.ZERO_ADDRESS, { from: Consumer, value: 5000 })
      await storageManager.incrementTime(2)
      await storageManager.setWhitelistedProvider(Provider2, false, { from: Owner })

      await expectRevert(
        storageManager.payoutFunds([cid], [Consumer], constants.ZERO_ADDRESS, Provider2, { from: Provider2 }),
        'StorageManager: provider is not whitelisted'
      )
    })
    it('should not be able to create agreement for offer which provider not whitelisted', async () => {
      await storageManager.setWhitelistedProvider(Provider2, true, { from: Owner })
      await storageManager.setOffer(1000, [[10, 100]], [[10, 80]], [constants.ZERO_ADDRESS], [], { from: Provider2 })
      await storageManager.setWhitelistedProvider(Provider2, false, { from: Owner })

      await expectRevert(
        storageManager.newAgreement(cid, Provider2, 100, 10, constants.ZERO_ADDRESS, 0, [], [], constants.ZERO_ADDRESS, { from: Consumer, value: 2000 }),
        'StorageManager: provider is not whitelisted'
      )
    })
    it('should not be able to deposit to agreement which provider not whitelisted', async () => {
      await storageManager.setWhitelistedProvider(Provider2, true, { from: Owner })
      await storageManager.setOffer(1000, [[10, 100]], [[10, 80]], [constants.ZERO_ADDRESS], [], { from: Provider2 })
      await storageManager.newAgreement(cid, Provider2, 100, 10, constants.ZERO_ADDRESS, 0, [], [], constants.ZERO_ADDRESS, { from: Consumer, value: 2000 })
      await storageManager.setWhitelistedProvider(Provider2, false, { from: Owner })

      await expectRevert(
        storageManager.depositFunds(constants.ZERO_ADDRESS, 0, cid, Provider2, { from: Consumer, value: 100 }),
        'StorageManager: provider is not whitelisted'
      )
    })
  })

  describe('setOffer', () => {
    it('should create new Offer for valid inputs', async () => {
      const msg = [padRight(asciiToHex('some string'), 64), padRight(asciiToHex('some other string'), 64)]
      const receipt = await storageManager.setOffer(1000, [[10, 100], [20, 100]], [[10, 80], [20, 80]], [constants.ZERO_ADDRESS, token.address], msg, { from: Provider })
      expectEvent(receipt, 'TotalCapacitySet', {
        provider: Provider,
        capacity: '1000'
      })
      expectEvent(receipt, 'BillingPlanSet', {
        provider: Provider,
        token: constants.ZERO_ADDRESS,
        period: '10',
        price: '10'
      })
      expectEvent(receipt, 'BillingPlanSet', {
        provider: Provider,
        token: token.address,
        period: '20',
        price: '20'
      })
      expectEvent(receipt, 'BillingPlanSet', {
        provider: Provider,
        token: constants.ZERO_ADDRESS,
        period: '100',
        price: '80'
      })
      expectEvent(receipt, 'BillingPlanSet', {
        provider: Provider,
        token: token.address,
        period: '100',
        price: '80'
      })

      // TODO: Waiting for support of asserting arrays to be released for validation of emitted message.
      expectEvent(receipt, 'MessageEmitted')
    })

    it('should revert for too big billing plan', async () => {
      await expectRevert(storageManager.setOffer(1000, [[1, 2, 15552101]], [[1, 2, 3]], [constants.ZERO_ADDRESS], [], { from: Provider }),
        'StorageManager: Billing period exceed max. length')
    })
  })

  describe('terminateOffer', function () {
    it('should terminate existing offer', async () => {
      await storageManager.setOffer(1000, [[10, 100]], [[10, 80]], [constants.ZERO_ADDRESS], [], { from: Provider })
      const receipt = await storageManager.terminateOffer({ from: Provider })
      expectEvent(receipt, 'TotalCapacitySet', {
        provider: Provider,
        capacity: '0'
      })
    })

    it('should revert for nonexisting offer', async () => {
      await expectRevert(storageManager.terminateOffer({ from: Provider }),
        'StorageManager: Offer for this Provider doesn\'t exist')
    })
  })

  describe('', () => {
    beforeEach(async () => {
      await init(Owner, Consumer, Provider)
    })

    describe('newAgreement', () => {
      describe('should create new Agreement for valid inputs', () => {
        it('native token', async () => {
          await storageManager.setOffer(1000, [[10, 100], [10, 100]], [[10, 80], [10, 80]], [constants.ZERO_ADDRESS, token.address], [], { from: Provider })

          const receipt = await storageManager.newAgreement(cid, Provider, 100, 10, constants.ZERO_ADDRESS, 0, [], [], constants.ZERO_ADDRESS, { from: Consumer, value: 2000 })
          expectEvent(receipt, 'NewAgreement', {
            provider: Provider,
            agreementCreator: Consumer,
            size: '100',
            billingPeriod: '10',
            token: constants.ZERO_ADDRESS,
            availableFunds: '2000'
          })
          await expectUtilizedCapacity(100)
        })
        it('erc20 token', async () => {
          await storageManager.setOffer(1000, [[10, 10], [10, 10]], [[10, 10], [10, 10]], [constants.ZERO_ADDRESS, token.address], [], { from: Provider })

          const balance = await token.balanceOf(Consumer)
          await token.approve(storageManager.address, 2000, { from: Consumer })
          const receipt = await storageManager.newAgreement(cid, Provider, 100, 10, token.address, 2000, [], [], token.address, { from: Consumer })

          const nextBalance = await token.balanceOf(Consumer)
          expect(nextBalance.toNumber()).to.be.eql(balance - 2000)

          expectEvent(receipt, 'NewAgreement', {
            provider: Provider,
            agreementCreator: Consumer,
            size: '100',
            billingPeriod: '10',
            token: token.address,
            availableFunds: '2000'
          })
          await expectUtilizedCapacity(100)
        })
      })

      describe('should be possible to create new agreement for reactivated Offer', () => {
        it('Native token', async () => {
          let receipt
          await storageManager.setOffer(1000, [[10, 100]], [[10, 80]], [constants.ZERO_ADDRESS], [], { from: Provider })
          receipt = await storageManager.newAgreement(cid, Provider, 100, 10, constants.ZERO_ADDRESS, 0, [], [], constants.ZERO_ADDRESS, { from: Consumer, value: 2000 })
          expectEvent(receipt, 'NewAgreement', {
            provider: Provider,
            agreementCreator: Consumer,
            size: '100',
            billingPeriod: '10',
            token: constants.ZERO_ADDRESS,
            availableFunds: '2000'
          })
          await expectUtilizedCapacity(100)

          await storageManager.terminateOffer({ from: Provider })
          await expectUtilizedCapacity(100)

          await expectRevert(
            storageManager.newAgreement(cid, Provider, 100, 10, constants.ZERO_ADDRESS, 0, [], [], constants.ZERO_ADDRESS, { from: Consumer, value: 2000 }),
            'StorageManager: Offer for this Provider doesn\'t exist'
          )

          await storageManager.setTotalCapacity(1500, { from: Provider })
          await expectUtilizedCapacity(100)
          receipt = await storageManager.newAgreement(cid, Provider, 100, 10, constants.ZERO_ADDRESS, 0, [], [], constants.ZERO_ADDRESS, { from: Owner, value: 2000 })
          expectEvent(receipt, 'NewAgreement', {
            provider: Provider,
            agreementCreator: Owner,
            size: '100',
            billingPeriod: '10',
            token: constants.ZERO_ADDRESS,
            availableFunds: '2000'
          })
          await expectUtilizedCapacity(200)
        })
        it('ERC20 token', async () => {
          let receipt
          await storageManager.setOffer(1000, [[10, 100]], [[10, 80]], [token.address], [], { from: Provider })
          await token.approve(storageManager.address, 4500, { from: Consumer })
          receipt = await storageManager.newAgreement(cid, Provider, 100, 10, token.address, 2000, [], [], token.address, { from: Consumer })
          expectEvent(receipt, 'NewAgreement', {
            provider: Provider,
            agreementCreator: Consumer,
            size: '100',
            billingPeriod: '10',
            token: token.address,
            availableFunds: '2000'
          })
          await expectUtilizedCapacity(100)

          await storageManager.terminateOffer({ from: Provider })
          await expectUtilizedCapacity(100)

          await expectRevert(
            storageManager.newAgreement(cid, Provider, 100, 10, token.address, 2000, [], [], token.address, { from: Consumer }),
            'StorageManager: Offer for this Provider doesn\'t exist')

          await storageManager.setTotalCapacity(1500, { from: Provider })
          await expectUtilizedCapacity(100)
          await token.approve(storageManager.address, 2000, { from: Owner })
          receipt = await storageManager.newAgreement(cid, Provider, 100, 10, token.address, 2000, [], [], token.address, { from: Owner })
          expectEvent(receipt, 'NewAgreement', {
            provider: Provider,
            agreementCreator: Owner,
            size: '100',
            billingPeriod: '10',
            token: token.address,
            availableFunds: '2000'
          })
          await expectUtilizedCapacity(200)
        })
      })

      it('should revert for non-existing/non-active Offer', async () => {
        await expectRevert(storageManager.newAgreement(cid, Provider, 100, 10, constants.ZERO_ADDRESS, 0, [], [], constants.ZERO_ADDRESS, { from: Consumer, value: 2000 }),
          'StorageManager: Offer for this Provider doesn\'t exist')
      })

      it('should revert for no billing period or size', async () => {
        await storageManager.setOffer(1000, [[10, 100]], [[10, 80]], [constants.ZERO_ADDRESS], [], { from: Provider })

        await expectRevert(storageManager.newAgreement(cid, Provider, 0, 10, constants.ZERO_ADDRESS, 0, [], [], constants.ZERO_ADDRESS, { from: Consumer, value: 2000 }),
          'StorageManager: Size has to be bigger then 0')
        await expectRevert(storageManager.newAgreement(cid, Provider, 100, 0, constants.ZERO_ADDRESS, 0, [], [], constants.ZERO_ADDRESS, { from: Consumer, value: 2000 }),
          'StorageManager: Billing period of 0 not allowed')
      })

      it('should payout funds when agreement already exists with running funds', async () => {
        await storageManager.setOffer(1000, [[10, 100]], [[10, 80]], [constants.ZERO_ADDRESS], [], { from: Provider })
        await storageManager.newAgreement(cid, Provider, 100, 10, constants.ZERO_ADDRESS, 0, [], [], constants.ZERO_ADDRESS, { from: Consumer, value: 2000 })
        await storageManager.incrementTime(11)

        const receipt = await storageManager.newAgreement(cid, Provider, 10, 100, constants.ZERO_ADDRESS, 0, [cid], [Consumer], constants.ZERO_ADDRESS, { from: Consumer, value: 2000 })
        expectEvent(receipt, 'AgreementFundsPayout', {
          amount: '1000'
        })
        expectEvent.notEmitted(receipt, 'AgreementStopped')
      })

      it('should change billing plan when agreement already exists with running funds', async () => {
        await storageManager.setOffer(1000, [[10, 100]], [[10, 100]], [constants.ZERO_ADDRESS], [], { from: Provider })
        await storageManager.newAgreement(cid, Provider, 100, 10, constants.ZERO_ADDRESS, 0, [], [], constants.ZERO_ADDRESS, {
          from: Consumer,
          value: 2000
        })
        await storageManager.incrementTime(1)

        // This call change the billing plan and saves the lastPayoutDate
        const receipt = await storageManager.newAgreement(cid, Provider, 100, 100, constants.ZERO_ADDRESS, 0, [], [], constants.ZERO_ADDRESS, { from: Consumer, value: 20000 })
        expectEvent.notEmitted(receipt, 'AgreementFundsPayout')
        expectEvent.notEmitted(receipt, 'AgreementStopped')

        // This is just before to be payedout
        await storageManager.incrementTime(99)
        let payoutReceipt = await storageManager.payoutFunds([cid], [Consumer], constants.ZERO_ADDRESS, Provider, { from: Provider })
        expectEvent.notEmitted(receipt, 'AgreementFundsPayout')
        expectEvent.notEmitted(receipt, 'AgreementStopped')

        await storageManager.incrementTime(1)
        payoutReceipt = await storageManager.payoutFunds([cid], [Consumer], constants.ZERO_ADDRESS, Provider, { from: Provider })
        expectEvent(payoutReceipt, 'AgreementFundsPayout', {
          amount: '10000'
        })
      })

      it('should revert when Offer does not have available capacity', async () => {
        await storageManager.setOffer(1000, [[10, 100]], [[10, 80]], [constants.ZERO_ADDRESS], [], { from: Provider })

        // Agreement that uses whole capacity of the offer
        await storageManager.newAgreement(cid, Provider, 900, 10, constants.ZERO_ADDRESS, 0, [], [], constants.ZERO_ADDRESS, {
          from: Owner,
          value: 10000
        })
        await expectUtilizedCapacity(900)

        // Revert because there is not enough capacity
        await expectRevert(storageManager.newAgreement(cid, Provider, 200, 10, constants.ZERO_ADDRESS, 0, [], [], constants.ZERO_ADDRESS, { from: Consumer, value: 2000 }),
          'StorageManager: Insufficient Offer\'s capacity')
      })

      it('should revert for non existing Billing plan', async () => {
        await storageManager.setOffer(1000, [[10, 100]], [[10, 80]], [constants.ZERO_ADDRESS], [], { from: Provider })
        await expectRevert(storageManager.newAgreement(cid, Provider, 100, 20, constants.ZERO_ADDRESS, 0, [], [], constants.ZERO_ADDRESS, { from: Consumer, value: 2000 }),
          'StorageManager: Billing price doesn\'t exist for Offer')
      })

      it('should revert when not enough value is deposited', async () => {
        await storageManager.setOffer(1000, [[10, 100]], [[10, 80]], [constants.ZERO_ADDRESS], [], { from: Provider })
        await expectRevert(storageManager.newAgreement(cid, Provider, 100, 10, constants.ZERO_ADDRESS, 0, [], [], constants.ZERO_ADDRESS, { from: Consumer, value: 10 }),
          'StorageManager: Funds deposited has to be for at least one billing period')
      })

      it('should recreate expired Agreement ', async () => {
        await storageManager.setOffer(1000, [[1, 2]], [[10, 20]], [constants.ZERO_ADDRESS], [], { from: Provider })
        await storageManager.newAgreement(cid, Provider, 100, 1, constants.ZERO_ADDRESS, 0, [], [], constants.ZERO_ADDRESS, {
          from: Consumer,
          value: 1500
        })

        await storageManager.incrementTime(1)

        await storageManager.payoutFunds([cid], [Consumer], constants.ZERO_ADDRESS, Provider, { from: Provider })
        const receipt = await storageManager.newAgreement(cid, Provider, 100, 2, constants.ZERO_ADDRESS, 0, [], [], constants.ZERO_ADDRESS, { from: Consumer, value: 2000 })
        expectEvent(receipt, 'NewAgreement', {
          provider: Provider,
          agreementCreator: Consumer,
          size: '100',
          billingPeriod: '2',
          token: constants.ZERO_ADDRESS,
          availableFunds: '2500'
        })
      })

      it('should payout, terminate and free-up capacity of Agreements specified by Consumer', async () => {
        await storageManager.setOffer(1000, [[10, 100]], [[10, 80]], [constants.ZERO_ADDRESS], [], { from: Provider })

        // Agreement that uses whole capacity of the offer
        const agreementReference = getAgreementReference(await storageManager.newAgreement(cid, Provider, 900, 10, constants.ZERO_ADDRESS, 0, [], [], constants.ZERO_ADDRESS, {
          from: Owner,
          value: 10000
        }))

        await expectUtilizedCapacity(900)

        // Revert because there is not enough capacity
        await expectRevert(storageManager.newAgreement(cid, Provider, 200, 10, constants.ZERO_ADDRESS, 0, [], [], constants.ZERO_ADDRESS, { from: Consumer, value: 2000 }),
          'StorageManager: Insufficient Offer\'s capacity')

        // Lets fast forward when the first Agreement run out of founds and hence is awaiting for termination
        await storageManager.incrementTime(30)

        const receipt = await storageManager.newAgreement(cid, Provider, 200, 10, constants.ZERO_ADDRESS, 0, [cid], [Owner], constants.ZERO_ADDRESS, {
          from: Consumer,
          value: 2000
        })
        expectEvent(receipt, 'NewAgreement', {
          provider: Provider,
          agreementCreator: Consumer,
          size: '200',
          billingPeriod: '10',
          token: constants.ZERO_ADDRESS,
          availableFunds: '2000'
        })
        expectEvent(receipt, 'AgreementFundsPayout', {
          agreementReference,
          amount: '9000'
        })
        expectEvent(receipt, 'AgreementStopped', {
          agreementReference
        })

        await expectUtilizedCapacity(200)
      })
    })

    describe('depositFunds', function () {
      describe('should deposit funds for valid inputs', () => {
        it('Native token', async () => {
          await storageManager.setOffer(1000, [[10, 100]], [[10, 80]], [constants.ZERO_ADDRESS], [], { from: Provider })
          await storageManager.newAgreement(cid, Provider, 100, 10, constants.ZERO_ADDRESS, 0, [], [], constants.ZERO_ADDRESS, { from: Consumer, value: 2000 })

          const receipt = await storageManager.depositFunds(constants.ZERO_ADDRESS, 0, cid, Provider, { from: Consumer, value: 100 })
          expectEvent(receipt, 'AgreementFundsDeposited', {
            amount: '100'
          })
        })
        it('ERC20 token', async () => {
          await storageManager.setOffer(1000, [[10, 100]], [[10, 80]], [token.address], [], { from: Provider })
          await token.approve(storageManager.address, 2000, { from: Consumer })
          await storageManager.newAgreement(cid, Provider, 100, 10, token.address, 2000, [], [], token.address, { from: Consumer })

          await token.approve(storageManager.address, 100, { from: Consumer })
          const receipt = await storageManager.depositFunds(token.address, 100, cid, Provider, { from: Consumer })
          expectEvent(receipt, 'AgreementFundsDeposited', {
            amount: '100'
          })
        })
      })

      it('should allow deposit funds when there is only last active period running', async () => {
        await storageManager.setOffer(1000, [[10, 100]], [[10, 80]], [constants.ZERO_ADDRESS], [], { from: Provider })
        await storageManager.newAgreement(cid, Provider, 100, 10, constants.ZERO_ADDRESS, 0, [], [], constants.ZERO_ADDRESS, { from: Consumer, value: 1000 })

        const receipt = await storageManager.depositFunds(constants.ZERO_ADDRESS, 0, cid, Provider, { from: Consumer, value: 100 })
        expectEvent(receipt, 'AgreementFundsDeposited', {
          amount: '100'
        })
      })

      it('should revert when offer does not exists', async () => {
        await expectRevert(storageManager.depositFunds(constants.ZERO_ADDRESS, 0, cid, Provider, { from: Consumer, value: 100 }),
          'StorageManager: Offer for this Provider doesn\'t exist')
      })

      it('should revert when agreement does not exists', async () => {
        await storageManager.setOffer(1000, [[10, 100]], [[10, 80]], [constants.ZERO_ADDRESS], [], { from: Provider })

        await expectRevert(storageManager.depositFunds(constants.ZERO_ADDRESS, 0, cid, Provider, { from: Consumer, value: 100 }),
          'StorageManager: Agreement for this Offer doesn\'t exist')
      })

      it('should revert when billing plans does not exist anymore', async () => {
        await storageManager.setOffer(1000, [[10, 100]], [[10, 80]], [constants.ZERO_ADDRESS], [], { from: Provider })
        await storageManager.newAgreement(cid, Provider, 100, 10, constants.ZERO_ADDRESS, 0, [], [], constants.ZERO_ADDRESS, { from: Consumer, value: 2000 })
        await storageManager.setBillingPlans([[10, 100]], [[0, 80]], [constants.ZERO_ADDRESS], { from: Provider })

        await expectRevert(storageManager.depositFunds(constants.ZERO_ADDRESS, 0, cid, Provider, { from: Consumer, value: 100 }),
          'StorageManager: Price not available anymore')
      })

      it('should revert when billing plans has changed', async () => {
        await storageManager.setOffer(1000, [[10, 100]], [[10, 80]], [constants.ZERO_ADDRESS], [], { from: Provider })
        await storageManager.newAgreement(cid, Provider, 100, 10, constants.ZERO_ADDRESS, 0, [], [], constants.ZERO_ADDRESS, { from: Consumer, value: 2000 })
        await storageManager.setBillingPlans([[10, 100]], [[50, 80]], [constants.ZERO_ADDRESS], { from: Provider })

        await expectRevert(storageManager.depositFunds(constants.ZERO_ADDRESS, 0, cid, Provider, { from: Consumer, value: 100 }),
          'StorageManager: Price not available anymore')
      })

      it('should revert when agreement is payed out', async () => {
        await storageManager.setOffer(1000, [[1, 100]], [[10, 80]], [constants.ZERO_ADDRESS], [], { from: Provider })
        await storageManager.newAgreement(cid, Provider, 100, 1, constants.ZERO_ADDRESS, 0, [], [], constants.ZERO_ADDRESS, {
          from: Consumer,
          value: 1500
        })
        await storageManager.incrementTime(1)

        await storageManager.payoutFunds([cid], [Consumer], constants.ZERO_ADDRESS, Provider, { from: Provider })
        await expectRevert(storageManager.depositFunds(constants.ZERO_ADDRESS, 0, cid, Provider, { from: Consumer, value: 100 }),
          'StorageManager: Agreement not active')
      })

      it('should revert when agreement ran out of funds', async () => {
        await storageManager.setOffer(1000, [[1, 100]], [[10, 80]], [constants.ZERO_ADDRESS], [], { from: Provider })
        await storageManager.newAgreement(cid, Provider, 100, 1, constants.ZERO_ADDRESS, 0, [], [], constants.ZERO_ADDRESS, {
          from: Consumer,
          value: 1500
        })
        await storageManager.incrementTime(2)

        await expectRevert(storageManager.depositFunds(constants.ZERO_ADDRESS, 0, cid, Provider, { from: Consumer, value: 100 }),
          'StorageManager: Agreement already ran out of funds')
      })
    })

    describe('withdrawFunds', function () {
      describe('should withdraw funds for valid inputs', () => {
        it('Native token', async () => {
          await storageManager.setOffer(1000, [[10, 100]], [[10, 80]], [constants.ZERO_ADDRESS], [], { from: Provider })
          await storageManager.newAgreement(cid, Provider, 100, 10, constants.ZERO_ADDRESS, 0, [], [], constants.ZERO_ADDRESS, { from: Consumer, value: 2000 })

          const receipt = await storageManager.withdrawFunds(cid, Provider, [constants.ZERO_ADDRESS], [1000], { from: Consumer })
          expectEvent(receipt, 'AgreementFundsWithdrawn', {
            amount: '1000'
          })
        })
        it('ERC20 token', async () => {
          await storageManager.setOffer(1000, [[10, 100]], [[10, 80]], [token.address], [], { from: Provider })
          await token.approve(storageManager.address, 2000, { from: Consumer })
          await storageManager.newAgreement(cid, Provider, 100, 10, token.address, 2000, [], [], token.address, { from: Consumer })

          const receipt = await storageManager.withdrawFunds(cid, Provider, [token.address], [1000], { from: Consumer })
          expectEvent(receipt, 'AgreementFundsWithdrawn', {
            amount: '1000'
          })
        })
      })

      it('should withdraw all available funds when zero is passed', async () => {
        await storageManager.setOffer(1000, [[10, 100]], [[10, 80]], [constants.ZERO_ADDRESS], [], { from: Provider })
        await storageManager.newAgreement(cid, Provider, 100, 10, constants.ZERO_ADDRESS, 0, [], [], constants.ZERO_ADDRESS, { from: Consumer, value: 2000 })

        const receipt = await storageManager.withdrawFunds(cid, Provider, [constants.ZERO_ADDRESS], [0], { from: Consumer })
        expectEvent(receipt, 'AgreementFundsWithdrawn', {
          amount: '1000'
        })
      })

      it('should revert when too big amount is requested to be withdrawn', async () => {
        await storageManager.setOffer(1000, [[10, 100]], [[10, 80]], [constants.ZERO_ADDRESS], [], { from: Provider })
        await storageManager.newAgreement(cid, Provider, 100, 10, constants.ZERO_ADDRESS, 0, [], [], constants.ZERO_ADDRESS, { from: Consumer, value: 3000 })

        // Should be 1 more ten limit. 100 (size) * 10 (price) = 1000 reserved and 2000 is available
        await expectRevert(storageManager.withdrawFunds(cid, Provider, [constants.ZERO_ADDRESS], [2001], { from: Consumer }),
          'StorageManager: Amount is too big')
      })

      it('should revert when somebody else then author of Agreement is trying to withdraw funds', async () => {
        await storageManager.setOffer(1000, [[10, 100]], [[10, 80]], [constants.ZERO_ADDRESS], [], { from: Provider })
        await storageManager.newAgreement(cid, Provider, 100, 10, constants.ZERO_ADDRESS, 0, [], [], constants.ZERO_ADDRESS, { from: Consumer, value: 3000 })

        await expectRevert(storageManager.withdrawFunds(cid, Provider, [constants.ZERO_ADDRESS], [1000], { from: Owner }),
          'StorageManager: Agreement for this Offer doesn\'t exist')
      })

      it('should revert when amount exceeds current period', async () => {
        await storageManager.setOffer(1000, [[10, 100]], [[10, 80]], [constants.ZERO_ADDRESS], [], { from: Provider })
        await storageManager.newAgreement(cid, Provider, 100, 10, constants.ZERO_ADDRESS, 0, [], [], constants.ZERO_ADDRESS, { from: Consumer, value: 2000 })

        await expectRevert(storageManager.withdrawFunds(cid, Provider, [constants.ZERO_ADDRESS], [1001], { from: Consumer }),
          'StorageManager: Amount is too big')
      })

      /**
       * The agreements has to block funds for all previous periods that were still not-payed out
       * to the Provider.
       */
      it('should revert when amount exceeds non-payed out periods', async () => {
        await storageManager.setOffer(1000, [[1, 10]], [[10, 80]], [constants.ZERO_ADDRESS], [], { from: Provider })
        await storageManager.newAgreement(cid, Provider, 100, 1, constants.ZERO_ADDRESS, 0, [], [], constants.ZERO_ADDRESS, { from: Consumer, value: 5000 })
        await storageManager.incrementTime(1)

        await expectRevert(storageManager.withdrawFunds(cid, Provider, [constants.ZERO_ADDRESS], [3001], { from: Consumer }),
          'StorageManager: Amount is too big')
      })

      it('should withdraw all funds except reserved funds for past periods and current period', async () => {
        await storageManager.setOffer(1000, [[1, 100]], [[10, 80]], [constants.ZERO_ADDRESS], [], { from: Provider })
        await storageManager.newAgreement(cid, Provider, 100, 1, constants.ZERO_ADDRESS, 0, [], [], constants.ZERO_ADDRESS, { from: Consumer, value: 5000 })
        await storageManager.incrementTime(1)

        const receipt = await storageManager.withdrawFunds(cid, Provider, [constants.ZERO_ADDRESS], [0], { from: Consumer })
        expectEvent(receipt, 'AgreementFundsWithdrawn', {
          amount: '3000'
        })
      })

      it('should revert because zero funds would be withdrawn as everything is reserved', async () => {
        await storageManager.setOffer(1000, [[1, 100]], [[10, 80]], [constants.ZERO_ADDRESS], [], { from: Provider })
        await storageManager.newAgreement(cid, Provider, 100, 1, constants.ZERO_ADDRESS, 0, [], [], constants.ZERO_ADDRESS, { from: Consumer, value: 5000 })
        await storageManager.incrementTime(4)

        await expectRevert(storageManager.withdrawFunds(cid, Provider, [constants.ZERO_ADDRESS], [0], { from: Consumer }),
          'StorageManager: Nothing to withdraw')
      })

      it('should revert when offer does not exists', async () => {
        await expectRevert(storageManager.withdrawFunds(cid, Provider, [constants.ZERO_ADDRESS], [100], { from: Consumer }),
          'StorageManager: Agreement for this Offer doesn\'t exist')
      })

      it('should revert when agreement does not exists', async () => {
        await storageManager.setOffer(1000, [[10, 100]], [[10, 80]], [constants.ZERO_ADDRESS], [], { from: Provider })

        await expectRevert(storageManager.withdrawFunds(cid, Provider, [constants.ZERO_ADDRESS], [100], { from: Consumer }),
          'StorageManager: Agreement for this Offer doesn\'t exist')
      })

      it('should withdraw all remaining funds when the agreement is expired', async () => {
        await storageManager.setOffer(1000, [[1, 100]], [[10, 80]], [constants.ZERO_ADDRESS], [], { from: Provider })
        const agreementReference = getAgreementReference(await storageManager.newAgreement(cid, Provider, 100, 1, constants.ZERO_ADDRESS, 0, [], [], constants.ZERO_ADDRESS, {
          from: Consumer,
          value: 2500
        }))
        await storageManager.incrementTime(2)

        const payoutReceipt = await storageManager.payoutFunds([cid], [Consumer], constants.ZERO_ADDRESS, Provider, { from: Provider })
        expectEvent(payoutReceipt, 'AgreementFundsPayout', {
          agreementReference,
          amount: '2000'
        })
        expectEvent(payoutReceipt, 'AgreementStopped', {
          agreementReference
        })

        const withdrawReceipt = await storageManager.withdrawFunds(cid, Provider, [constants.ZERO_ADDRESS], [0], { from: Consumer })
        expectEvent(withdrawReceipt, 'AgreementFundsWithdrawn', {
          amount: '500'
        })
      })
    })

    describe('payoutFunds', function () {
      describe('should payout funds for valid inputs', () => {
        it('Native token', async () => {
          await storageManager.setOffer(1000, [[1, 100]], [[10, 80]], [constants.ZERO_ADDRESS], [], { from: Provider })
          await storageManager.newAgreement(cid, Provider, 100, 1, constants.ZERO_ADDRESS, 0, [], [], constants.ZERO_ADDRESS, { from: Consumer, value: 5000 })
          await storageManager.incrementTime(2)

          const receipt = await storageManager.payoutFunds([cid], [Consumer], constants.ZERO_ADDRESS, Provider, { from: Provider })
          expectEvent(receipt, 'AgreementFundsPayout', {
            amount: '2000'
          })
        })
        it('ERC20 token', async () => {
          await storageManager.setOffer(1000, [[1, 100]], [[10, 80]], [token.address], [], { from: Provider })
          await token.approve(storageManager.address, 5000, { from: Consumer })
          await storageManager.newAgreement(cid, Provider, 100, 1, token.address, 5000, [], [], token.address, { from: Consumer })
          await storageManager.incrementTime(2)

          const receipt = await storageManager.payoutFunds([cid], [Consumer], token.address, Provider, { from: Provider })
          expectEvent(receipt, 'AgreementFundsPayout', {
            amount: '2000'
          })
        })
      })

      it('should not do anything when nothing is to payout', async () => {
        await storageManager.setOffer(1000, [[1, 100]], [[10, 100]], [constants.ZERO_ADDRESS], [], { from: Provider })
        await storageManager.newAgreement(cid, Provider, 100, 100, constants.ZERO_ADDRESS, 0, [], [], constants.ZERO_ADDRESS, { from: Consumer, value: 50000 })
        await storageManager.incrementTime(2)

        const receipt = await storageManager.payoutFunds([cid], [Consumer], constants.ZERO_ADDRESS, Provider, { from: Provider })
        expectEvent.notEmitted(receipt, 'AgreementFundsPayout')
        expectEvent.notEmitted(receipt, 'AgreementStopped')
      })

      it('should not be able to payout currently running period', async () => {
        await storageManager.setOffer(1000, [[1, 100]], [[10, 100]], [constants.ZERO_ADDRESS], [], { from: Provider })
        await storageManager.newAgreement(cid, Provider, 100, 100, constants.ZERO_ADDRESS, 0, [], [], constants.ZERO_ADDRESS, { from: Consumer, value: 50000 })
        await storageManager.incrementTime(50) // In the middle of

        const receipt = await storageManager.payoutFunds([cid], [Consumer], constants.ZERO_ADDRESS, Provider, { from: Provider })
        expectEvent.notEmitted(receipt, 'AgreementFundsPayout')
        expectEvent.notEmitted(receipt, 'AgreementStopped')
      })

      it('should payout funds and stop agreement when run out of funds', async () => {
        await storageManager.setOffer(1000, [[1, 100]], [[10, 80]], [constants.ZERO_ADDRESS], [], { from: Provider })
        const agreementReference = getAgreementReference(
          await storageManager.newAgreement(cid, Provider, 100, 1, constants.ZERO_ADDRESS, 0, [], [], constants.ZERO_ADDRESS, { from: Consumer, value: 2500 })
        )

        await expectUtilizedCapacity(100)
        await storageManager.incrementTime(2)

        const receipt = await storageManager.payoutFunds([cid], [Consumer], constants.ZERO_ADDRESS, Provider, { from: Provider })
        expectEvent(receipt, 'AgreementFundsPayout', {
          agreementReference,
          amount: '2000'
        })
        expectEvent(receipt, 'AgreementStopped', {
          agreementReference
        })
        await expectUtilizedCapacity(0)
      })
    })

    describe('Pausable', () => {
      it('should not be able to create offer when paused', async () => {
        await storageManager.pause({ from: Owner })
        expect(await storageManager.paused()).to.be.eql(true)
        const msg = [padRight(asciiToHex('some string'), 64), padRight(asciiToHex('some other string'), 64)]
        await expectRevert(
          storageManager.setOffer(1000, [[10, 100], [20, 100]], [[10, 80], [20, 80]], [constants.ZERO_ADDRESS, token.address], msg, { from: Provider }),
          'Pausable: paused'
        )
      })
      it('should not be able to to set capacity when paused', async () => {
        await storageManager.setOffer(1000, [[10, 100], [20, 100]], [[10, 80], [20, 80]], [constants.ZERO_ADDRESS, token.address], [], { from: Provider })
        await storageManager.pause({ from: Owner })
        await expectRevert(
          storageManager.setTotalCapacity(23, { from: Provider }),
          'Pausable: paused'
        )
      })
      it('should not be able to set billing plans when paused', async () => {
        await storageManager.setOffer(1000, [[10, 100], [20, 100]], [[10, 80], [20, 80]], [constants.ZERO_ADDRESS, token.address], [], { from: Provider })
        await storageManager.pause({ from: Owner })
        await expectRevert(
          storageManager.setBillingPlans([[1, 2]], [[1, 2]], [constants.ZERO_ADDRESS], { from: Provider }),
          'Pausable: paused'
        )
      })
      it('should not be able to create agreement when paused', async () => {
        await storageManager.setOffer(1000, [[10, 100], [20, 100]], [[10, 80], [20, 80]], [constants.ZERO_ADDRESS, token.address], [], { from: Provider })
        await storageManager.pause({ from: Owner })
        await expectRevert(
          storageManager.newAgreement(cid, Provider, 100, 10, constants.ZERO_ADDRESS, 0, [], [], constants.ZERO_ADDRESS, { from: Consumer, value: 2000 }),
          'Pausable: paused'
        )
      })
      it('should not be able to deposit when paused', async () => {
        await storageManager.setOffer(1000, [[10, 100], [20, 100]], [[10, 80], [20, 80]], [constants.ZERO_ADDRESS, token.address], [], { from: Provider })
        await storageManager.pause({ from: Owner })
        await expectRevert(
          storageManager.depositFunds(constants.ZERO_ADDRESS, 0, cid, Provider, { from: Consumer, value: 100 }),
          'Pausable: paused'
        )
      })
      it('should be able to withdrawFunds when paused', async () => {
        await storageManager.setOffer(1000, [[10, 100], [20, 100]], [[10, 80], [20, 80]], [constants.ZERO_ADDRESS, token.address], [], { from: Provider })
        await storageManager.newAgreement(cid, Provider, 100, 10, constants.ZERO_ADDRESS, 0, [], [], constants.ZERO_ADDRESS, { from: Consumer, value: 2000 })
        await storageManager.pause({ from: Owner })
        const receipt = await storageManager.withdrawFunds(cid, Provider, [constants.ZERO_ADDRESS], [1000], { from: Consumer })
        expectEvent(receipt, 'AgreementFundsWithdrawn', {
          amount: '1000'
        })
      })
      it('should be able to payoutFunds when paused', async () => {
        await storageManager.setOffer(1000, [[1, 100]], [[10, 80]], [constants.ZERO_ADDRESS], [], { from: Provider })
        await storageManager.newAgreement(cid, Provider, 100, 1, constants.ZERO_ADDRESS, 0, [], [], constants.ZERO_ADDRESS, { from: Consumer, value: 5000 })
        await storageManager.pause({ from: Owner })
        await storageManager.incrementTime(2)

        const receipt = await storageManager.payoutFunds([cid], [Consumer], constants.ZERO_ADDRESS, Provider, { from: Provider })
        expectEvent(receipt, 'AgreementFundsPayout', {
          amount: '2000'
        })
      })
      it('should be able to to terminate offer when paused', async () => {
        await storageManager.setOffer(1000, [[10, 100], [20, 100]], [[10, 80], [20, 80]], [constants.ZERO_ADDRESS, token.address], [], { from: Provider })
        await storageManager.pause({ from: Owner })
        const receipt = await storageManager.terminateOffer({ from: Provider })
        expectEvent(receipt, 'TotalCapacitySet', {
          provider: Provider,
          capacity: '0'
        })
      })
    })

    describe('Upgrades', () => {
      it('should allow owner to upgrade', async () => {
        const storageManagerUpg = await upgradeProxy(storageManager.address, StorageManagerV2, { unsafeAllowCustomTypes: true })
        const version = await storageManagerUpg.getVersion()
        expect(storageManagerUpg.address).to.be.eq(storageManager.address)
        expect(version).to.be.eq('V2')
      })

      it('should not allow non-owner to upgrade', async () => {
        await transferProxyAdminOwnership(Provider)
        await expectRevert.unspecified(
          upgradeProxy(storageManager.address, StorageManagerV2, { unsafeAllowCustomTypes: true })
        )
      })
    })
  })
})
