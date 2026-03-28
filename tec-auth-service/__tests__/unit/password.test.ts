import bcrypt from 'bcrypt';

describe('Password Hashing', () => {

  it('hashes a password', async () => {
    const hash = await bcrypt.hash('password123', 10);
    expect(hash).toBeDefined();
    expect(hash).not.toBe('password123');
    expect(hash.length).toBeGreaterThan(20);
  });

  it('verifies correct password', async () => {
    const hash = await bcrypt.hash('password123', 10);
    const valid = await bcrypt.compare('password123', hash);
    expect(valid).toBe(true);
  });

  it('rejects wrong password', async () => {
    const hash = await bcrypt.hash('password123', 10);
    const valid = await bcrypt.compare('wrongpassword', hash);
    expect(valid).toBe(false);
  });

  it('generates unique hashes for same password', async () => {
    const hash1 = await bcrypt.hash('password123', 10);
    const hash2 = await bcrypt.hash('password123', 10);
    expect(hash1).not.toBe(hash2);
    expect(await bcrypt.compare('password123', hash1)).toBe(true);
    expect(await bcrypt.compare('password123', hash2)).toBe(true);
  });

  it('rejects empty password', async () => {
    const hash = await bcrypt.hash('password123', 10);
    const valid = await bcrypt.compare('', hash);
    expect(valid).toBe(false);
  });
});
