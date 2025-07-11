const express = require('express')
const supabase = require('../config/supabase')
const { authenticateToken } = require('../middleware/auth')

const router = express.Router()

// Get current user profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, name, phone, balance, total_earnings, tasks_completed, referrals_count, referral_code, created_at, updated_at')
      .eq('id', req.user.id)
      .single()

    if (error) {
      throw error
    }

    res.json({ user })

  } catch (error) {
    console.error('Get profile error:', error)
    res.status(500).json({ error: 'Failed to fetch user profile' })
  }
})

// Update user profile
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { name, phone } = req.body
    const updates = {}

    if (name) updates.name = name
    if (phone) updates.phone = phone
    
    updates.updated_at = new Date().toISOString()

    const { data: user, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', req.user.id)
      .select('id, email, name, phone, balance, total_earnings, tasks_completed, referrals_count, referral_code, created_at, updated_at')
      .single()

    if (error) {
      throw error
    }

    res.json({
      message: 'Profile updated successfully',
      user
    })

  } catch (error) {
    console.error('Update profile error:', error)
    res.status(500).json({ error: 'Failed to update profile' })
  }
})

// Get user statistics
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id

    // Get basic user stats
    const { data: user } = await supabase
      .from('users')
      .select('balance, total_earnings, tasks_completed, referrals_count')
      .eq('id', userId)
      .single()

    // Get referral earnings
    const { data: referralEarnings } = await supabase
      .from('referrals')
      .select('bonus_earned')
      .eq('referrer_id', userId)

    const totalReferralEarnings = referralEarnings?.reduce((sum, ref) => sum + ref.bonus_earned, 0) || 0

    // Get recent tasks
    const { data: recentTasks } = await supabase
      .from('user_tasks')
      .select('reward_amount, completed_at')
      .eq('user_id', userId)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(10)

    res.json({
      stats: {
        ...user,
        referral_earnings: totalReferralEarnings,
        recent_tasks: recentTasks || []
      }
    })

  } catch (error) {
    console.error('Get stats error:', error)
    res.status(500).json({ error: 'Failed to fetch user statistics' })
  }
})

// Update user balance (internal use)
router.post('/balance/update', authenticateToken, async (req, res) => {
  try {
    const { amount, type, description } = req.body // type: 'add' or 'subtract'

    if (!amount || !type) {
      return res.status(400).json({ error: 'Amount and type are required' })
    }

    const userId = req.user.id
    const balanceChange = type === 'add' ? amount : -amount

    // Update user balance
    const { data: user, error } = await supabase
      .from('users')
      .update({
        balance: supabase.sql`balance + ${balanceChange}`,
        total_earnings: type === 'add' ? supabase.sql`total_earnings + ${amount}` : supabase.sql`total_earnings`,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId)
      .select('balance, total_earnings')
      .single()

    if (error) {
      throw error
    }

    // Create transaction record
    await supabase
      .from('transactions')
      .insert({
        user_id: userId,
        amount: balanceChange,
        type,
        description: description || `Balance ${type}`,
        status: 'completed'
      })

    res.json({
      message: 'Balance updated successfully',
      balance: user.balance,
      total_earnings: user.total_earnings
    })

  } catch (error) {
    console.error('Update balance error:', error)
    res.status(500).json({ error: 'Failed to update balance' })
  }
})

module.exports = router