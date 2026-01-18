# Contributing to Mobile Dev MCP

Thank you for your interest in contributing! This project uses an "Open Core" model with dual licensing.

## Understanding the License Structure

### MIT Licensed (Basic Tools)
The 17 basic tools are MIT licensed. Contributions to these tools will be MIT licensed:
- All tools in `BASIC_TOOLS` array in `src/license.ts`
- Core Android logging and device tools
- Core iOS simulator tools
- License management tools

### Elastic License 2.0 (Advanced Tools)
The 39 advanced tools are under Elastic License 2.0. Contributions to these tools will be under Elastic 2.0:
- All tools in `ADVANCED_TOOLS` array in `src/license.ts`
- Streaming and monitoring tools
- Device interaction tools
- React DevTools integration
- Network inspection
- Expo DevTools integration
- Performance metrics

## How to Contribute

### Reporting Bugs
1. Check existing issues first
2. Create a new issue with:
   - Clear description
   - Steps to reproduce
   - Expected vs actual behavior
   - Your environment (OS, Node version, etc.)

### Feature Requests
1. Open an issue describing the feature
2. Explain the use case
3. Suggest which tier it should belong to (Basic or Advanced)

### Pull Requests

1. **Fork the repository**
   ```bash
   git clone https://github.com/GGBoi360/mobile-dev-mcp.git
   cd mobile-dev-mcp
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Create a branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

4. **Make your changes**
   - Follow the existing code style
   - Add tests for new functionality
   - Update documentation

5. **Run tests**
   ```bash
   npm run build
   npm test
   ```

6. **Submit PR**
   - Clear description of changes
   - Reference any related issues
   - Indicate which license applies (MIT or Elastic)

## Adding New Tools

### 1. Define the tool in `src/index.ts`
```typescript
{
  name: "your_new_tool",
  description: "What this tool does",
  inputSchema: {
    type: "object",
    properties: {
      // Your parameters
    }
  }
}
```

### 2. Add to license arrays in `src/license.ts`
- Add to `BASIC_TOOLS` for core functionality (MIT)
- Add to `ADVANCED_TOOLS` for pro features (Elastic)

### 3. Implement the tool function
```typescript
async function yourNewTool(args: YourArgs): Promise<string> {
  // Check license
  const check = await requireBasic("your_new_tool"); // or requireAdvanced
  if (!check.allowed) {
    return check.message!;
  }

  // Your implementation
  let result = "...";

  // Include trial message if present
  if (check.message) {
    result += `\n\n${check.message}`;
  }

  return result;
}
```

### 4. Add case handler in the switch statement

### 5. Add tests in `src/*.test.ts`

### 6. Update documentation
- Update tool counts in README.md
- Update ARCHITECTURE.md
- Add to CHANGELOG.md

## Code Style

- TypeScript with strict mode
- Use async/await for asynchronous code
- Descriptive variable names
- Comment complex logic
- Keep functions focused and small

## Testing

- Run `npm test` before submitting
- Add tests for new tools
- Test both success and error cases
- Test license gating works correctly

## Questions?

- GitHub Issues: https://github.com/GGBoi360/mobile-dev-mcp/issues
- Twitter: @GiliboiGabay
- Email: GiladGabay@proton.me

Thank you for contributing!
