# 本地 CLI 接口

桌面端在「设置 → MarginStudy → 本地 CLI 连接」中手动启用。服务只监听 `127.0.0.1`，端口由系统分配，令牌仅在当前会话的设置界面显示。关闭、重载插件或重启后，服务关闭，令牌与写入授权失效。移动端不提供服务。

所有请求使用 `Authorization: Bearer <令牌>`；不要把令牌写入脚本、仓库或聊天记录。接口返回完整本地文档或卡片数据，请只授权可信的本机程序。服务不会主动发送数据，也不调用 AI。浏览器来源、转发头、非回环来源和非回环 Host 均被拒绝。

```sh
curl -H "Authorization: Bearer $MARGINSTUDY_TOKEN" "http://127.0.0.1:$MARGINSTUDY_PORT/status"
curl -H "Authorization: Bearer $MARGINSTUDY_TOKEN" "http://127.0.0.1:$MARGINSTUDY_PORT/documents"
curl -H "Authorization: Bearer $MARGINSTUDY_TOKEN" "http://127.0.0.1:$MARGINSTUDY_PORT/cards"
```

上述命令中的环境变量由本机用户自行设置；端口和令牌以设置界面当前值为准。读取不会修改学习库。`GET /status` 返回启用状态、写权限及当前 Store revision；另外两个接口分别返回 `documents`、`cards` 数组。

写入默认关闭。打开「允许本地写入」后，可以为已有卡片批量添加标签：

```sh
curl -X POST -H "Authorization: Bearer $MARGINSTUDY_TOKEN" -H 'Content-Type: application/json' \
  --data '{"action":"add-tags","cardIds":["card-id"],"tags":["标签"]}' \
  "http://127.0.0.1:$MARGINSTUDY_PORT/organize"
```

`cardIds` 最多 100 项，`tags` 最多 50 项，单次请求不超过 64 KiB。缺失卡片或无效请求会整体拒绝，不进行部分写入；成功返回 `{"changed":数量}`。实际发生变化的批量命令对应一次学习库事务，可使用「撤销最近一次学习库操作」一次恢复；没有变化时不创建撤销项。
