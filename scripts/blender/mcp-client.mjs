// Reproducible model authoring through the Blender MCP stdio server.
// Set BLENDER_MCP_COMMAND to its executable and start the Blender addon first.
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const client = new Client({
  name: "inventory-furniture-authoring",
  version: "1.0.0",
});
const installedCommand = path.join(homedir(), ".local/share/blender-mcp/blender-mcp");
const transport = new StdioClientTransport({
  command: process.env.BLENDER_MCP_COMMAND || (existsSync(installedCommand) ? installedCommand : "blender-mcp"),
  env: { ...process.env, DISABLE_TELEMETRY: "true" },
  stderr: "inherit",
});
try {
  await client.connect(transport);
  const codePath = process.argv[2];
  const result = codePath
    ? await client.callTool(
        {
          name: "execute_blender_code",
          arguments: {
            code: `INVENTORY_PROJECT_DIR = ${JSON.stringify(process.cwd())}\n${await readFile(codePath, "utf8")}`,
            user_prompt:
              "Erstelle und prüfe die bearbeitbare Möbelbibliothek für die Raumdarstellung.",
          },
        },
        undefined,
        { timeout: 180000 },
      )
    : await client.callTool({
        name: "get_scene_info",
        arguments: {
          user_prompt:
            "Erstelle und prüfe die bearbeitbare Möbelbibliothek für die Raumdarstellung.",
        },
      });
  console.log(JSON.stringify(result));
  if (
    result.isError ||
    result.content?.some(
      (item) =>
        item.type === "text" &&
        /Error executing|Traceback|Error getting/i.test(item.text),
    )
  )
    process.exitCode = 1;
} finally {
  await client.close();
}
