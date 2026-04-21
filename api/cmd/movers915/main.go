package main

import (
	"log"
	"os"

	"github.com/gin-gonic/gin"
	"tradestrom-api/db"
	"tradestrom-api/handlers"
	"tradestrom-api/routes"
)

func main() {
	mysqlDSN := os.Getenv("MYSQL_DSN")
	internalSecret := os.Getenv("INTERNAL_API_SECRET")
	port := os.Getenv("PORT")

	if mysqlDSN == "" {
		log.Fatal("MYSQL_DSN must be configured")
	}

	if internalSecret == "" {
		log.Fatal("INTERNAL_API_SECRET must be configured")
	}

	if port == "" {
		port = "8081"
	}

	database, err := db.New(mysqlDSN)
	if err != nil {
		log.Fatalf("failed to connect database: %v", err)
	}
	defer database.Close()

	handler := handlers.New(database)

	router := gin.New()
	router.Use(gin.Logger())
	router.Use(gin.Recovery())

	routes.Register(router, handler, internalSecret)

	log.Printf("Movers915 API listening on :%s", port)
	if err := router.Run(":" + port); err != nil {
		log.Fatalf("server failed: %v", err)
	}
}
