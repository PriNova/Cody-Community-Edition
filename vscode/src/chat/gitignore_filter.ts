import * as fs from 'fs';
import * as path from 'path';

export class GitignoreFilter {
    private patterns: string[] = [];
    private gitignorePath: string;

    constructor(workspaceRoot: string) {
        this.gitignorePath = path.join(workspaceRoot, '.gitignore');
        this.loadGitignore();
    }

    private loadGitignore(): void {
        try {
            if (fs.existsSync(this.gitignorePath)) {
                const gitignoreContent = fs.readFileSync(this.gitignorePath, 'utf8');
                this.patterns = gitignoreContent
                    .split('\n')
                    .map(line => line.trim())
                    .filter(line => line && !line.startsWith('#'));
            }
        } catch (error) {
            console.error('Error loading .gitignore:', error);
        }
    }

    private matchesPattern(filePath: string, pattern: string): boolean {
        // Convert Windows paths to forward slashes
        filePath = filePath.replace(/\\/g, '/');
        pattern = pattern.replace(/\\/g, '/');

        // Handle negation patterns
        if (pattern.startsWith('!')) {
            return !this.matchesPattern(filePath, pattern.slice(1));
        }

        // Handle directory-specific patterns
        if (pattern.startsWith('/')) {
            pattern = pattern.slice(1);
        }

        // Handle directory markers
        if (pattern.endsWith('/')) {
            pattern = pattern.slice(0, -1);
        }

        // Convert glob patterns to regex
        const regexPattern = pattern
            .replace(/\./g, '\\.')
            .replace(/\*\*/g, '.*')
            .replace(/\*/g, '[^/]*')
            .replace(/\?/g, '[^/]');

        const regex = new RegExp(`^${regexPattern}$`);
        return regex.test(filePath);
    }

    public shouldIncludeInContext(filePath: string): boolean {
        // Convert absolute path to relative path from workspace root
        const workspaceRoot = path.dirname(this.gitignorePath);
        const relativePath = path.relative(workspaceRoot, filePath);
        
        // Always exclude .git directory
        if (relativePath.startsWith('.git' + path.sep) || relativePath === '.git') {
            return false;
        }

        // Check if the path matches any gitignore patterns
        for (const pattern of this.patterns) {
            if (this.matchesPattern(relativePath, pattern)) {
                return false;
            }
        }

        return true;
    }

    public filterPaths(paths: string[]): string[] {
        return paths.filter(p => this.shouldIncludeInContext(p));
    }
}
