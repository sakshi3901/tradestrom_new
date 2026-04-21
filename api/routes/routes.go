package routes

import (
	"github.com/gin-gonic/gin"
	"tradestrom-api/handlers"
	"tradestrom-api/middleware"
)

func Register(router *gin.Engine, handler *handlers.APIHandler, internalSecret string) {
	router.GET("/health", handler.Health)

	marketRoutes := router.Group("")
	marketRoutes.Use(middleware.InternalSecret(internalSecret))
	{
		marketRoutes.GET("/ohlc", handler.GetOHLC)
		marketRoutes.GET("/movers", handler.GetMovers)
		marketRoutes.GET("/contribution-series", handler.GetContributionSeries)
		marketRoutes.GET("/movers/915", handler.GetMovers915)
		marketRoutes.GET("/movers/snapshot", handler.GetMoversSnapshot)
		marketRoutes.GET("/options/snapshot", handler.GetOptionSnapshot)
		marketRoutes.GET("/options/range", handler.GetOptionRange)
		marketRoutes.GET("/options/diff", handler.GetOptionDiff)
	}

	v1 := router.Group("/v1")
	v1.Use(middleware.InternalSecret(internalSecret))
	{
		v1.GET("/access/check", handler.CheckAccess)
		v1.POST("/access/grant", handler.GrantAccess)
		v1.POST("/access/revoke", handler.RevokeAccess)
		v1.GET("/users", handler.ListUsers)
		v1.GET("/admin/zerodha", handler.GetZerodhaSettings)
		v1.POST("/admin/zerodha", handler.UpsertZerodhaSettings)
		v1.GET("/ohlc", handler.GetOHLC)
		v1.GET("/movers", handler.GetMovers)
		v1.GET("/contribution-series", handler.GetContributionSeries)
		v1.GET("/movers/915", handler.GetMovers915)
		v1.GET("/movers/snapshot", handler.GetMoversSnapshot)
		v1.GET("/options/snapshot", handler.GetOptionSnapshot)
		v1.GET("/options/range", handler.GetOptionRange)
		v1.GET("/options/diff", handler.GetOptionDiff)
		v1.GET("/community/posts", handler.ListCommunityPosts)
		v1.POST("/community/posts", handler.CreateCommunityPost)
		v1.DELETE("/community/posts/:id", handler.DeleteCommunityPost)
		v1.POST("/community/posts/:id/like", handler.ToggleCommunityPostLike)
		v1.GET("/admin/community/posts", handler.ListAdminCommunityPosts)
		v1.POST("/admin/community/posts/:id/status", handler.UpdateCommunityPostStatus)
	}
}
