/**
 * Unit tests for Git parsers
 */

import { describe, it, expect } from 'vitest';
import { parseWorktreeList, parseStatus, parseBranchList } from '../src/git/client.js';

describe('GitClient Parsers', () => {
  describe('parseWorktreeList', () => {
    it('parses main worktree', () => {
      const output = `worktree /Users/user/project
HEAD abc123def456
branch refs/heads/main

`;
      const worktrees = parseWorktreeList(output);
      
      expect(worktrees).toHaveLength(1);
      expect(worktrees[0]?.path).toBe('/Users/user/project');
      expect(worktrees[0]?.branch).toBe('main');
      expect(worktrees[0]?.isMain).toBe(true);
    });

    it('parses multiple worktrees', () => {
      const output = `worktree /Users/user/project
HEAD abc123def456
branch refs/heads/main

worktree /Users/user/project-feature
HEAD def789ghi012
branch refs/heads/feature/payment

`;
      const worktrees = parseWorktreeList(output);
      
      expect(worktrees).toHaveLength(2);
      expect(worktrees[0]?.path).toBe('/Users/user/project');
      expect(worktrees[1]?.path).toBe('/Users/user/project-feature');
      expect(worktrees[1]?.branch).toBe('feature/payment');
    });

    it('handles bare worktree', () => {
      const output = `worktree /Users/user/bare
HEAD abc123def456
bare true

`;
      const worktrees = parseWorktreeList(output);
      
      expect(worktrees).toHaveLength(1);
      expect(worktrees[0]?.isBare).toBe(true);
    });
  });

  describe('parseStatus', () => {
    it('parses clean status', () => {
      const output = `# branch.oid abc123def456
# branch.head main
# branch.upstream origin/main
# branch.ab +1 -2

`;
      const status = parseStatus(output, 'main');
      
      expect(status.isClean).toBe(true);
      expect(status.ahead).toBe(1);
      expect(status.behind).toBe(2);
    });

    it('parses modified files', () => {
      const output = `# branch.oid abc123
# branch.head main
1 .M N... 100644 100644 100644 file1.ts
1 ..M N... 100644 100644 100644 file2.ts
`;
      const status = parseStatus(output, 'main');
      
      expect(status.isClean).toBe(false);
      expect(status.modified).toContain('file2.ts');
    });

    it('parses untracked files', () => {
      const output = `# branch.oid abc123
# branch.head main
? newfile.ts
`;
      const status = parseStatus(output, 'main');
      
      expect(status.isClean).toBe(false);
      expect(status.untracked).toContain('newfile.ts');
    });

    it('deduplicates files', () => {
      const output = `# branch.oid abc123
# branch.head main
1 .M N... 100644 100644 100644 file.ts
1 ..M N... 100644 100644 100644 file.ts
`;
      const status = parseStatus(output, 'main');
      
      expect(status.modified.filter(f => f === 'file.ts')).toHaveLength(1);
    });
  });

  describe('parseBranchList', () => {
    it('parses branches', () => {
      const output = `main|origin/main|*|
feature|feature^u||
`;
      const branches = parseBranchList(output);
      
      expect(branches).toHaveLength(2);
      expect(branches[0]?.name).toBe('main');
      expect(branches[0]?.isCurrent).toBe(true);
      expect(branches[1]?.name).toBe('feature');
      expect(branches[1]?.upstream).toBe('feature^u');
    });
  });
});
