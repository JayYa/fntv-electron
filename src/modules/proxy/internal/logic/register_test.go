package logic

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestHealthResponseContract(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := newRouter()

	recorder := httptest.NewRecorder()
	r.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/health", nil))

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", recorder.Code)
	}

	var payload struct {
		Service  string `json:"service"`
		Protocol int    `json:"protocol"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode health response: %v", err)
	}
	if payload.Service != "fntv-proxy" || payload.Protocol != 1 {
		t.Fatalf("unexpected health response: %+v", payload)
	}
}
