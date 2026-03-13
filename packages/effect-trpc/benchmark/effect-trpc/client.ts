import type { AppRouter } from './generated/routes'

// Simulating effect-trpc client API
type InferInput<T> = T extends { input: infer I } ? I extends { Type: infer IT } ? IT : never : never
type InferOutput<T> = T extends { output: infer O } ? O extends { Type: infer OT } ? OT : never : never

interface Client<TRouter> {
  [K in keyof TRouter]: {
    query: (input: InferInput<TRouter[K]>) => Promise<InferOutput<TRouter[K]>>
    mutate: (input: InferInput<TRouter[K]>) => Promise<InferOutput<TRouter[K]>>
  }
}

declare const trpc: Client<AppRouter>

// Test autocomplete and type inference
async function testQueries() {
  // Route 0
  const result_0000 = await trpc.route_0000.query({ id: 'test' })
  console.log(result_0000)

  // Route 1
  const result_0001 = await trpc.route_0001.query({ id: 'test' })
  console.log(result_0001)

  // Route 10
  const result_0010 = await trpc.route_0010.query({ id: 'test' })
  console.log(result_0010)

  // Route 50
  const result_0050 = await trpc.route_0050.query({ id: 'test' })
  console.log(result_0050)

  // Route 100
  const result_0100 = await trpc.route_0100.query({ id: 'test' })
  console.log(result_0100)

  // Route 3200
  const result_3200 = await trpc.route_3200.query({ id: 'test' })
  console.log(result_3200)

  // Route 6399
  const result_6399 = await trpc.route_6399.query({ id: 'test' })
  console.log(result_6399)
}

// Test accessing nested properties (hover test)
async function testTypeInference() {
  const result = await trpc.route_0000.query({ id: '123' })
  
  // These should all have proper types
  const id: string = result.id
  const name: string = result.name
  
  console.log(id, name)
}

// Test error detection (wrong input type)
async function testErrorDetection() {
  // @ts-expect-error - id should be string, not number
  await trpc.route_0000.query({ id: 123 })
}

export { testQueries, testTypeInference }
