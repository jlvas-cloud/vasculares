#!/usr/bin/env node
/**
 * Create User Script
 * Creates a new user in both the central auth database and company local database
 *
 * Usage:
 *   node scripts/create-user.js --firstname "Daniel" --lastname "Subero" --email "dsubero@hospalmedica.com" --password "123456"
 *
 * Options:
 *   --firstname   First name (required)
 *   --lastname    Last name (required)
 *   --email       Email address (required, must be unique)
 *   --password    Password (required)
 *   --dry-run     Show what would be created without actually creating
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { getUserModel, getLocalUsersModel, getCompanyModel } = require('../getModel');

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
      options[key] = value;
      if (value !== true) i++;
    }
  }

  return options;
}

async function createUser(options) {
  const { firstname, lastname, email, password, 'dry-run': dryRun } = options;

  // Validate required fields
  if (!firstname || !lastname || !email || !password) {
    console.error('Error: Missing required fields');
    console.error('Usage: node scripts/create-user.js --firstname "First" --lastname "Last" --email "email@example.com" --password "password"');
    process.exit(1);
  }

  const companyId = process.env.COMPANY_ID;
  if (!companyId) {
    console.error('Error: COMPANY_ID not set in environment');
    process.exit(1);
  }

  console.log('\n=== Create User Script ===\n');
  console.log('User details:');
  console.log(`  Name: ${firstname} ${lastname}`);
  console.log(`  Email: ${email.toLowerCase()}`);
  console.log(`  Company ID: ${companyId}`);
  console.log(`  Dry run: ${dryRun ? 'Yes' : 'No'}\n`);

  try {
    // Get models
    const AuthUsers = await getUserModel();
    const LocalUsers = await getLocalUsersModel(companyId);
    const Company = await getCompanyModel();

    // Check if email already exists in auth database
    const existingAuth = await AuthUsers.findOne({ email: email.toLowerCase() });
    if (existingAuth) {
      console.error(`Error: Email "${email}" already exists in auth database`);
      process.exit(1);
    }

    // Check if email already exists in local database
    const existingLocal = await LocalUsers.findOne({ email: email.toLowerCase() });
    if (existingLocal) {
      console.error(`Error: Email "${email}" already exists in local database`);
      process.exit(1);
    }

    // Get company info
    const company = await Company.findById(companyId);
    if (!company) {
      console.error(`Error: Company not found with ID ${companyId}`);
      process.exit(1);
    }

    console.log(`Company: ${company.name}\n`);

    if (dryRun) {
      console.log('[DRY RUN] Would create:');
      console.log('  1. Local user in company database');
      console.log('  2. Auth user in central database');
      console.log('\nRun without --dry-run to create the user.');
      process.exit(0);
    }

    // Step 1: Create local user in company database
    console.log('Creating local user...');
    const localUser = new LocalUsers({
      firstname,
      lastname,
      email: email.toLowerCase(),
      password, // Virtual setter will hash it
      status: 'active',
      role: {
        isAdmin: false,
        isOperaciones: false,
        isVentas: false,
        isServicio: false,
        isEC: false,
        isObservador: true, // Default role
        isLider: false,
        isCronograma: false,
        isDocumentos: false
      },
      permissions: [],
      deactivated: false
    });

    await localUser.save();
    console.log(`  Created local user: ${localUser._id}`);

    // Step 2: Create auth user in central database
    console.log('Creating auth user...');
    const authUser = new AuthUsers({
      firstname,
      lastname,
      email: email.toLowerCase(),
      password, // Virtual setter will hash it
      userId: localUser._id,
      company: {
        _id: company._id,
        name: company.name
      },
      deactivated: false
    });

    await authUser.save();
    console.log(`  Created auth user: ${authUser._id}`);

    console.log('\n=== User Created Successfully ===\n');
    console.log('User can now login with:');
    console.log(`  Email: ${email.toLowerCase()}`);
    console.log(`  Password: ${password}`);
    console.log('\nNote: User will have "viewer" role in Vasculares by default.');
    console.log('Use the /users page to assign a different role.\n');

  } catch (error) {
    console.error('Error creating user:', error.message);
    if (error.code === 11000) {
      console.error('Duplicate key error - email may already exist');
    }
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

// Run
const options = parseArgs();
createUser(options);
