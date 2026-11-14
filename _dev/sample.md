# 一、基本概念

设 $A$ 是集合，$|A| = n$。若 $f: A \to B$ 是**单射**，则 $|A| \le |B|$。

关系 $R$ 在 $A$ 上满足：$\forall a,b \in A,\ aRb \iff [a] = [b]$。

$$
\forall x \in A,\ \exists y \in B :\quad x \le y \implies P(x)
$$

## 1.1 真值表

| $p$ | $q$ | $p \land q$ | $p \to q$ |
|---|---|---|---|
| T | T | T | T |
| T | F | F | F |
| F | T | F | T |
| F | F | F | T |

## 1.2 证明

- 充分性：若 $R$ 是等价关系，则 $R$ 自反、对称、传递。
- 必要性：反之亦可。

1. 取 $a \in A$，则 $aRa$。
2. 故 $[a] \neq \varnothing$。

## 1.3 图

```tikz
\node[circle,draw] (a) at (0,0) {$a$};
\node[circle,draw] (b) at (2,0) {$b$};
\node[circle,draw] (c) at (1,1.6) {$c$};
\draw[->] (a) -- (b);
\draw[->] (b) -- (c);
\draw[->] (c) -- (a);
```

特判：$100\%$ 的 A&B 成立，变量 `x_i` 有效。

---

*注：以上为测试内容。*
