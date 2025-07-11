const express = require('express')
const supabase = require('../config/supabase')
const { authenticateToken } = require('../middleware/auth')

const router = express.Router()

const MINIMUM_WITHDRAWAL = 25000 // COP
const WITHDRAWAL_FEE_PERCENTAGE = 0.10 // 10%

// Get user's withdrawal history
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query

    const { data: withdrawals, error } = await supabase
      .from('withdrawals')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      throw error
    }

    res.json({ withdrawals })

  } catch (error) {
    console.error('Get withdrawals error:', error)
    res.status(500).json({ error: 'Failed to fetch withdrawals' })
  }
})

// Request withdrawal
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { amount, method, account_info } = req.body
    const userId = req.user.id

    // Validate input
    if (!amount || !method || !account_info) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['amount', 'method', 'account_info']
      })
    }

    if (!['paypal', 'nequi'].includes(method)) {
      return res.status(400).json({ error: 'Invalid withdrawal method' })
    }

    if (amount < MINIMUM_WITHDRAWAL) {
      return res.status(400).json({
        error: `Minimum withdrawal amount is COP ${MINIMUM_WITHDRAWAL.toLocaleString()}`
      })
    }

    // Check user balance
    const { data: user } = await supabase
      .from('users')
      .select('balance')
      .eq('id', userId)
      .single()

    if (!user || user.balance < amount) {
      return res.status(400).json({ error: 'Insufficient balance' })
    }

    // Calculate fee and net amount
    const fee = Math.round(amount * WITHDRAWAL_FEE_PERCENTAGE)
    const netAmount = amount - fee

    // Create withdrawal request
    const { data: withdrawal, error: withdrawalError } = await supabase
      .from('withdrawals')
      .insert({
        user_id: userId,
        amount,
        method,
        account_info,
        fee,
        net_amount: netAmount,
        status: 'pending'
      })
      .select()
      .single()

    if (withdrawalError) {
      throw withdrawalError
    }

    // Deduct amount from user balance
    await supabase
      .from('users')
      .update({
        balance: supabase.sql`balance - ${amount}`,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId)

    // Create notification
    await supabase
      .from('notifications')
      .insert({
        user_id: userId,
        title: 'Solicitud de retiro recibida',
        message: `Tu solicitud de retiro por COP ${amount.toLocaleString()} ha sido recibida y está siendo procesada.`,
        type: 'info'
      })

    res.status(201).json({
      message: 'Withdrawal request created successfully',
      withdrawal
    })

  } catch (error) {
    console.error('Create withdrawal error:', error)
    res.status(500).json({ error: 'Failed to create withdrawal request' })
  }
})

// Get withdrawal methods and limits
router.get('/methods', authenticateToken, async (req, res) => {
  try {
    const methods = [
      {
        id: 'paypal',
        name: 'PayPal',
        description: 'Retiro a cuenta PayPal',
        min_amount: MINIMUM_WITHDRAWAL,
        fee_percentage: WITHDRAWAL_FEE_PERCENTAGE * 100,
        processing_time: '1-3 días hábiles',
        active: true
      },
      {
        id: 'nequi',
        name: 'Nequi',
        description: 'Retiro a cuenta Nequi',
        min_amount: MINIMUM_WITHDRAWAL,
        fee_percentage: WITHDRAWAL_FEE_PERCENTAGE * 100,
        processing_time: '1-2 días hábiles',
        active: true
      }
    ]

    res.json({ methods })

  } catch (error) {
    console.error('Get withdrawal methods error:', error)
    res.status(500).json({ error: 'Failed to fetch withdrawal methods' })
  }
})

// Calculate withdrawal fee
router.post('/calculate-fee', authenticateToken, async (req, res) => {
  try {
    const { amount } = req.body

    if (!amount || amount < MINIMUM_WITHDRAWAL) {
      return res.status(400).json({
        error: `Amount must be at least COP ${MINIMUM_WITHDRAWAL.toLocaleString()}`
      })
    }

    const fee = Math.round(amount * WITHDRAWAL_FEE_PERCENTAGE)
    const netAmount = amount - fee

    res.json({
      amount,
      fee,
      net_amount: netAmount,
      fee_percentage: WITHDRAWAL_FEE_PERCENTAGE * 100
    })

  } catch (error) {
    console.error('Calculate fee error:', error)
    res.status(500).json({ error: 'Failed to calculate withdrawal fee' })
  }
})

module.exports = router