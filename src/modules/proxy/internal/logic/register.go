package logic

import (
	"proxy/internal/logic/api"
	"proxy/pkg/logger"

	"github.com/gin-gonic/gin"
)

// RunApiServer 启动 API 服务器
func RunApiServer(addr string) error {
	gin.SetMode(gin.ReleaseMode)
	r := newRouter()

	logger.Infof("服务器启动在:%s", addr)
	return r.Run(addr)
}

func newRouter() *gin.Engine {
	// gin.Default 的访问日志会包含完整 query，其中带有播放 token。
	// 各处理器已经记录不含凭据的必要上下文，这里只保留崩溃恢复。
	r := gin.New()
	r.Use(gin.Recovery())

	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"service": "fntv-proxy", "protocol": 1})
	})
	r.GET("/api/v1/playvideo/:itemGuid", api.PlayVideoHandler)
	r.GET("/api/v1/skipinfo/:itemGuid", api.GetSkipInfoHandler)
	r.POST("/api/v1/skipinfo", api.SetSkipInfoHandler)

	// 404 路由
	r.NoRoute(func(c *gin.Context) {
		logger.Warnf("收到404请求: %s %s", c.Request.Method, c.Request.URL.Path)
		c.JSON(404, gin.H{"error": "Not Found"})
	})

	return r
}
