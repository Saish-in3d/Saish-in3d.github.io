---
layout: post
title: "Hello, world: what this site is for"
tags: [meta]
---

This is where I'll write about the things I build: Unreal Engine plugins, GPU compute, and the plumbing that gets real video and rendered CG into the same frame.

Expect three kinds of posts:

- **Deep dives** into how a project works, such as how [SynthPass](https://github.com/Saish-in3d/SynthPass) resolves translucent materials against a live plate in a single pass.
- **Lesson notes** from my compute-shader series, from a first dispatch through to instanced boids.
- **Small fixes** that took me too long to find, written down so they take you less time.

## Writing a new article

Each article is a Markdown file in the `_posts` folder, named `YYYY-MM-DD-title.md`. Code blocks work as you'd expect:

```hlsl
[numthreads(8, 8, 1)]
void MainCS(uint3 id : SV_DispatchThreadID)
{
    float2 uv = (id.xy + 0.5) / OutputSize;
    Output[id.xy] = float4(uv, 0.0, 1.0);
}
```

That's a compute shader writing a UV gradient into a render target, the "hello, world" of GPU programming.
