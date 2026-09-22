# Agentic RAG-权限

> <span style="color: rgb(0, 0, 0)">关于agentic rag的数据源权限问题，我觉得很多时候是不需要 agentic rag 模块去考虑的。在绝大多数应用场景下，我们都是为已有的多源信息资产来构造 agentic rag，而这些信息资产（代码库、数据库、文档库、配置库）都有自己的鉴权机制，在搭建 agentic rag 时，我们为他配置的这套原始信息资产，是绑定的他个人账户，而各个数据源本身就对账户有权限机制，个人账户没有的权限，agent 也没有权限（除非有漏洞），此时，agent 提示我们去进行账号登陆来授权，或者我们给agent提供一个权限token，不然我们的agentic rag压根没权限去访问的那些东西，对吧</span>

## 标签



## 题目导航

← [Agentic-RAG-如何进行构建](006-Agentic-RAG-如何进行构建.md) | [grep](008-grep.md) →

<!-- created: 2026-09-22 18:29:05 -->
<!-- updated: 2026-09-22 18:34:18 -->
