const express = require('express')
const bcrypt = require('bcryptjs')
const { v4: uuidv4 } = require('uuid')
const supabase = require('../config/supabase')
const { generateToken } = require('../middleware/auth')

const router = express.Router()

// Register new user
router.post('/register', async (req, res) => {
  try {
    const { email, password, name, phone, referralCode } = req.body

    // Validate required fields
    if (!email || !password || !name || !phone) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['email', 'password', 'name', 'phone']
      })
    }

    // Check if user already exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single()

    if (existingUser) {
      return res.status(400).json({ error: 'User already exists with this email' })
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12)

    // Generate unique referral code
    const userReferralCode = Math.random().toString(36).substring(2, 8).toUpperCase()

    // Check if referral code exists and get referrer
    let referrerId = null
    if (referralCode) {
      const { data: referrer } = await supabase
        .from('users')
        .select('id')
        .eq('referral_code', referralCode)
        .single()
      
      if (referrer) {
        referrerId = referrer.id
      }
    }

    // Create user
    const userId = uuidv4()
    const { data: newUser, error: userError } = await supabase
      .from('users')
      .insert({
        id: userId,
        email,
        password: hashedPassword,
        name,
        phone,
        balance: 0,
        total_earnings: 0,
        tasks_completed: 0,
        referrals_count: 0,
        referral_code: userReferralCode,
        referred_by: referrerId,
      })
      .select()
      .single()

    if (userError) {
      throw userError
    }

    // Create referral record if referred
    if (referrerId) {
      await supabase
        .from('referrals')
        .insert({
          referrer_id: referrerId,
          referred_id: userId,
          bonus_earned: 0,
          tasks_completed: 0,
        })

      // Increment referrer's referral count
      await supabase
        .from('users')
        .update({ referrals_count: supabase.sql`referrals_count + 1` })
        .eq('id', referrerId)
    }

    // Generate JWT token
    const token = generateToken(userId)

    // Remove password from response
    const { password: _, ...userResponse } = newUser

    res.status(201).json({
      message: 'User created successfully',
      user: userResponse,
      token
    })

  } catch (error) {
    console.error('Registration error:', error)
    res.status(500).json({ error: 'Failed to create user' })
  }
})

// Login user
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' })
    }

    // Find user by email
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single()

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password)
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    // Generate JWT token
    const token = generateToken(user.id)

    // Remove password from response
    const { password: _, ...userResponse } = user

    res.json({
      message: 'Login successful',
      user: userResponse,
      token
    })

  } catch (error) {
    console.error('Login error:', error)
    res.status(500).json({ error: 'Login failed' })
  }
})

// Refresh token
router.post('/refresh', async (req, res) => {
  try {
    const { token } = req.body

    if (!token) {
      return res.status(401).json({ error: 'Refresh token required' })
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    const newToken = generateToken(decoded.userId)

    res.json({ token: newToken })

  } catch (error) {
    console.error('Token refresh error:', error)
    res.status(403).json({ error: 'Invalid refresh token' })
  }
})

module.exports = router