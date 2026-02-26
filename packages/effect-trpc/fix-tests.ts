import { Project, SyntaxKind } from "ts-morph"

const project = new Project({
  tsConfigFilePath: "tsconfig.json",
})

const sourceFiles = project.getSourceFiles("src/__tests__/**/*.ts*")

for (const sourceFile of sourceFiles) {
  let changed = false

  // Replace `procedures("name", { ... })` with `Procedures.make({ ... })`
  const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)
  for (const callExpr of callExpressions) {
    const expr = callExpr.getExpression()
    if (expr.getText() === "procedures") {
      const args = callExpr.getArguments()
      if (args.length === 2) {
        callExpr.replaceWithText(`Procedures.make(${args[1].getText()})`)
        changed = true
      }
    }
  }

  // Replace `procedure` with `Procedure`
  const identifiers = sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)
  for (const id of identifiers) {
    if (id.getText() === "procedure") {
      id.replaceWithText("Procedure")
      changed = true
    }
  }

  // Replace `import { procedure, procedures } from ...` with `import { Procedure, Procedures } from ...`
  const importDecls = sourceFile.getImportDeclarations()
  for (const importDecl of importDecls) {
    const namedImports = importDecl.getNamedImports()
    for (const namedImport of namedImports) {
      if (namedImport.getName() === "procedure") {
        namedImport.setName("Procedure")
        changed = true
      }
      if (namedImport.getName() === "procedures") {
        namedImport.setName("Procedures")
        changed = true
      }
    }
  }

  if (changed) {
    console.log(`Updated ${sourceFile.getFilePath()}`)
    sourceFile.saveSync()
  }
}
