import bcrypt from 'bcryptjs';

describe('Auth Service - Password Hashing', () => {
  it('should hash a password', async () => {
    const password = 'testPassword123';
    const hashedPassword = await bcrypt.hash(password, 10);
    
    expect(hashedPassword).toBeDefined();
    expect(hashedPassword).not.toBe(password);
    expect(hashedPassword.length).toBeGreaterThan(20);
  });

  it('should verify a correct password', async () => {
    const password = 'testPassword123';
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const isValid = await bcrypt.compare(password, hashedPassword);
    expect(isValid).toBe(true);
  });

  it('should reject an incorrect password', async () => {
    const password = 'testPassword123';
    const wrongPassword = 'wrongPassword456';
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const isValid = await bcrypt.compare(wrongPassword, hashedPassword);
    expect(isValid).toBe(false);
  });

  it('should generate unique hashes for same password', async () => {
    const password = 'testPassword123';
    const hash1 = await bcrypt.hash(password, 10);
    const hash2 = await bcrypt.hash(password, 10);
    
    expect(hash1).not.toBe(hash2);
    expect(await bcrypt.compare(password, hash1)).toBe(true);
    expect(await bcrypt.compare(password, hash2)).toBe(true);
  });
});