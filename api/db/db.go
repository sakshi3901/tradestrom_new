package db

import (
	"database/sql"
	"embed"
	"fmt"
	"strings"
	"time"

	_ "github.com/go-sql-driver/mysql"
)

//go:embed schema.sql
var schemaFS embed.FS

func New(dsn string) (*sql.DB, error) {
	database, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, fmt.Errorf("open mysql: %w", err)
	}

	database.SetMaxIdleConns(10)
	database.SetMaxOpenConns(30)
	database.SetConnMaxLifetime(30 * time.Minute)

	if err := database.Ping(); err != nil {
		return nil, fmt.Errorf("ping mysql: %w", err)
	}

	if err := runMigrations(database); err != nil {
		return nil, err
	}

	return database, nil
}

func runMigrations(database *sql.DB) error {
	schemaBytes, err := schemaFS.ReadFile("schema.sql")
	if err != nil {
		return fmt.Errorf("read schema: %w", err)
	}

	statements := splitSQLStatements(string(schemaBytes))
	if len(statements) == 0 {
		return nil
	}

	tx, err := database.Begin()
	if err != nil {
		return fmt.Errorf("start migration transaction: %w", err)
	}

	for _, stmt := range statements {
		if _, err := tx.Exec(stmt); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("run migration statement: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit migration transaction: %w", err)
	}

	return nil
}

func splitSQLStatements(schema string) []string {
	parts := strings.Split(schema, ";")
	statements := make([]string, 0, len(parts))

	for _, part := range parts {
		stmt := strings.TrimSpace(part)
		if stmt == "" {
			continue
		}
		statements = append(statements, stmt)
	}

	return statements
}
